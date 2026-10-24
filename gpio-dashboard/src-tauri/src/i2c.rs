//! Reads the address grid that `i2cdetect -y <bus>` prints.
//!
//! Each row is a label `NN:` (the high nibble of the first address) followed by 16 cells
//! of two characters and a space. A cell is blank (address outside the scanned range),
//! `--` (no reply), `UU` (a kernel driver holds the address) or the address itself in hex.
//! Blank cells are real whitespace, so the grid is read by column position, using the
//! offsets of the digits in the header line, and never by splitting on whitespace.

use serde::Serialize;

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct I2cDevice {
    pub address: u8,
    /// Shown as `UU`: a kernel driver has the address, so it was not probed.
    pub claimed: bool,
}

const HIGHEST_BUS: u8 = 31;
/// Width of a row label such as `20:`.
const LABEL_LEN: usize = 3;
/// Where the header's first digit sits: after `NN: ` and the first cell's first character.
const FIRST_DIGIT: usize = LABEL_LEN + 2;
/// The highest high nibble: I2C addresses are 7 bits.
const HIGHEST_ROW: u32 = 7;

/// The remote command that scans one bus.
pub fn i2cdetect_command(bus: u8) -> Result<String, String> {
    if bus > HIGHEST_BUS {
        return Err(format!("Invalid I2C bus {bus}: use 0 to {HIGHEST_BUS}"));
    }
    Ok(format!("i2cdetect -y {bus}"))
}

/// Parses the grid into the devices that answered, in ascending address order.
pub fn parse_i2cdetect(output: &str) -> Result<Vec<I2cDevice>, String> {
    let mut lines = output.lines();
    let columns = lines
        .find_map(header_columns)
        .ok_or_else(|| no_grid(output))?;

    let mut devices = Vec::new();
    let mut previous_row = None;
    for line in lines.filter(|line| !line.trim().is_empty()) {
        let row: Vec<char> = line.chars().collect();
        let high = row_label(&row)
            .ok_or_else(|| format!("Unexpected line in the i2cdetect grid: {}", line.trim_end()))?;
        if previous_row.is_some_and(|previous| high <= previous) {
            return Err(format!("Row {high:x}0 is repeated or out of order"));
        }
        previous_row = Some(high);
        parse_row(&row, &columns, high, &mut devices)?;
    }
    if previous_row.is_none() {
        return Err("The i2cdetect grid has no rows".to_string());
    }
    Ok(devices)
}

/// Without a grid the output is whatever i2cdetect said instead, e.g. "Error: Could not
/// open file ...", which is the useful part to show.
fn no_grid(output: &str) -> String {
    let text = output.trim();
    if text.is_empty() {
        "i2cdetect printed nothing".to_string()
    } else {
        format!("No i2cdetect grid in the output: {text}")
    }
}

/// The character offset of each column's header digit (the last character of its cell),
/// or `None` if this line is not the header `0 1 2 ... f`.
fn header_columns(line: &str) -> Option<[usize; 16]> {
    let mut columns = [0; 16];
    let mut count = 0;
    let mut previous_blank = true;
    for (offset, ch) in line.chars().enumerate() {
        let blank = ch.is_whitespace();
        if !blank {
            // Each digit must stand alone, in order.
            if !previous_blank || count == 16 || ch.to_digit(16) != Some(count as u32) {
                return None;
            }
            columns[count] = offset;
            count += 1;
        }
        previous_blank = blank;
    }
    // Cells are 3 wide, so digits closer than that are not a real header.
    if count != 16 || columns.windows(2).any(|pair| pair[1] < pair[0] + 3) {
        return None;
    }
    // Rows never start with whitespace but the header does, so trimming the whole output
    // (a common cleanup of command output) strips the header's indent. The first digit
    // always sits over the second character of the first cell, just right of `NN: `.
    let shift = FIRST_DIGIT.saturating_sub(columns[0]);
    for column in &mut columns {
        *column += shift;
    }
    Some(columns)
}

/// The high nibble from a row label such as `30:`.
fn row_label(row: &[char]) -> Option<u8> {
    match row {
        [high, '0', ':', ..] => high
            .to_digit(16)
            .filter(|&n| n <= HIGHEST_ROW)
            .map(|n| n as u8),
        _ => None,
    }
}

fn parse_row(
    row: &[char],
    columns: &[usize; 16],
    high: u8,
    devices: &mut Vec<I2cDevice>,
) -> Result<(), String> {
    // Trailing blanks are often trimmed, so anything past the end reads as a space.
    let at = |index: usize| row.get(index).copied().unwrap_or(' ');
    let malformed = || format!("Row {high:x}0 does not line up with the header");

    // The space after the label, the space after each cell and everything after the
    // last cell must be blank. A row shifted by a character or with a wider cell is
    // refused instead of being read as different addresses.
    if !at(LABEL_LEN).is_whitespace() {
        return Err(malformed());
    }
    for (low, &digit) in columns.iter().enumerate() {
        if !at(digit + 1).is_whitespace() {
            return Err(malformed());
        }
        let low = low as u8;
        let address = (high << 4) | low;
        let cell: String = [at(digit - 1), at(digit)].iter().collect();
        match cell.as_str() {
            "  " | "--" => {}
            "UU" => devices.push(I2cDevice {
                address,
                claimed: true,
            }),
            _ if cell.chars().all(|c| c.is_ascii_hexdigit()) => {
                if u8::from_str_radix(&cell, 16) != Ok(address) {
                    return Err(format!(
                        "Row {high:x}0, column {low:x} shows {cell} but should show {address:02x}"
                    ));
                }
                devices.push(I2cDevice {
                    address,
                    claimed: false,
                });
            }
            _ => {
                return Err(format!(
                    "Row {high:x}0, column {low:x} has an unreadable cell {cell:?}"
                ))
            }
        }
    }
    if row.iter().skip(columns[15] + 2).any(|c| !c.is_whitespace()) {
        return Err(malformed());
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    /// `i2cdetect -y 1` with devices at 0x27, 0x3b (claimed by a driver) and 0x48.
    const EXAMPLE: [&str; 9] = [
        "     0  1  2  3  4  5  6  7  8  9  a  b  c  d  e  f",
        "00:                         -- -- -- -- -- -- -- -- ",
        "10: -- -- -- -- -- -- -- -- -- -- -- -- -- -- -- -- ",
        "20: -- -- -- -- -- -- -- 27 -- -- -- -- -- -- -- -- ",
        "30: -- -- -- -- -- -- -- -- -- -- -- UU -- -- -- -- ",
        "40: -- -- -- -- -- -- -- -- 48 -- -- -- -- -- -- -- ",
        "50: -- -- -- -- -- -- -- -- -- -- -- -- -- -- -- -- ",
        "60: -- -- -- -- -- -- -- -- -- -- -- -- -- -- -- -- ",
        "70: -- -- -- -- -- -- -- --                         ",
    ];

    fn device(address: u8, claimed: bool) -> I2cDevice {
        I2cDevice { address, claimed }
    }

    fn example_devices() -> Vec<I2cDevice> {
        vec![device(0x27, false), device(0x3b, true), device(0x48, false)]
    }

    fn example() -> String {
        EXAMPLE.join("\n") + "\n"
    }

    /// Replaces one line of the example grid.
    fn example_with_line(index: usize, line: &str) -> String {
        let mut lines: Vec<String> = EXAMPLE.iter().map(|l| l.to_string()).collect();
        lines[index] = line.to_string();
        lines.join("\n") + "\n"
    }

    /// Prints a grid the way i2cdetect does for the scanned range `first..=last`:
    /// rows outside the range are left out and cells outside it are blank.
    fn grid(first: u8, last: u8, cells: &[(u8, &str)]) -> String {
        let mut text = String::from("     0  1  2  3  4  5  6  7  8  9  a  b  c  d  e  f\n");
        for row_start in (0..128u8).step_by(16) {
            if row_start + 15 < first || row_start > last {
                continue;
            }
            text += &format!("{row_start:02x}: ");
            for address in row_start..row_start + 16 {
                if address < first || address > last {
                    text += "   ";
                } else {
                    let shown = cells
                        .iter()
                        .find(|(a, _)| *a == address)
                        .map_or("--", |&(_, cell)| cell);
                    text += &format!("{shown} ");
                }
            }
            text += "\n";
        }
        text
    }

    #[test]
    fn parses_the_example_grid() {
        assert_eq!(parse_i2cdetect(&example()), Ok(example_devices()));
    }

    #[test]
    fn the_generated_default_grid_matches_the_example() {
        let generated = grid(0x08, 0x77, &[(0x27, "27"), (0x3b, "UU"), (0x48, "48")]);
        assert_eq!(generated, example());
    }

    #[test]
    fn an_empty_bus_has_no_devices() {
        assert_eq!(parse_i2cdetect(&grid(0x08, 0x77, &[])), Ok(vec![]));
        assert_eq!(parse_i2cdetect(&grid(0x00, 0x7f, &[])), Ok(vec![]));
    }

    #[test]
    fn a_full_range_grid_with_every_cell_filled_lists_every_address() {
        let shown: Vec<(u8, String)> = (0..=0x7f).map(|a| (a, format!("{a:02x}"))).collect();
        let cells: Vec<(u8, &str)> = shown.iter().map(|(a, s)| (*a, s.as_str())).collect();
        let devices = parse_i2cdetect(&grid(0x00, 0x7f, &cells)).unwrap();
        assert_eq!(devices.len(), 128);
        assert!(devices
            .iter()
            .enumerate()
            .all(|(i, d)| d.address == i as u8 && !d.claimed));
    }

    #[test]
    fn the_full_range_includes_address_zero_and_the_last_address() {
        let text = grid(0x00, 0x7f, &[(0x00, "00"), (0x03, "UU"), (0x7f, "7f")]);
        assert_eq!(
            parse_i2cdetect(&text),
            Ok(vec![
                device(0x00, false),
                device(0x03, true),
                device(0x7f, false)
            ])
        );
    }

    #[test]
    fn blank_cells_do_not_shift_the_columns() {
        // Devices in the first and last cells of the default range, next to blank cells.
        let text = grid(0x08, 0x77, &[(0x08, "08"), (0x77, "77")]);
        assert_eq!(
            parse_i2cdetect(&text),
            Ok(vec![device(0x08, false), device(0x77, false)])
        );
    }

    #[test]
    fn a_narrow_scan_range_prints_only_its_rows() {
        let text = grid(0x48, 0x4f, &[(0x48, "48"), (0x4f, "UU")]);
        assert_eq!(text.lines().count(), 2, "header and one row");
        assert_eq!(
            parse_i2cdetect(&text),
            Ok(vec![device(0x48, false), device(0x4f, true)])
        );
    }

    #[test]
    fn uppercase_hex_is_accepted() {
        let text = grid(0x08, 0x77, &[(0x4a, "4A")]);
        assert_eq!(parse_i2cdetect(&text), Ok(vec![device(0x4a, false)]));
    }

    #[test]
    fn trailing_whitespace_and_line_ending_variations_change_nothing() {
        let trimmed: String = EXAMPLE
            .iter()
            .map(|l| format!("{}\n", l.trim_end()))
            .collect();
        let padded: String = EXAMPLE.iter().map(|l| format!("{l}   \t\n")).collect();
        let windows: String = EXAMPLE.iter().map(|l| format!("{l}\r\n")).collect();
        let windows_trimmed: String = EXAMPLE
            .iter()
            .map(|l| format!("{}\r\n", l.trim_end()))
            .collect();
        let variations = [
            ("trimmed lines", trimmed.clone()),
            ("padded lines", padded),
            ("crlf", windows),
            ("crlf and trimmed", windows_trimmed),
            ("no final newline", EXAMPLE.join("\n")),
            ("no final newline, trimmed", trimmed.trim_end().to_string()),
            ("blank lines around", format!("\n\n{}\n\n", example())),
            // Trimming strips the header's leading indent.
            ("whole output trimmed", example().trim().to_string()),
            (
                "every line trimmed on both sides",
                EXAMPLE.map(str::trim).join("\n"),
            ),
        ];
        for (name, text) in variations {
            assert_eq!(parse_i2cdetect(&text), Ok(example_devices()), "{name}");
        }
    }

    #[test]
    fn text_before_the_header_is_ignored() {
        let text = format!(
            "WARNING! This program can confuse your I2C bus\n{}",
            example()
        );
        assert_eq!(parse_i2cdetect(&text), Ok(example_devices()));
    }

    #[test]
    fn error_text_instead_of_a_grid_is_returned_as_the_error() {
        let open =
            "Error: Could not open file `/dev/i2c-1' or `/dev/i2c/1': No such file or directory\n";
        let err = parse_i2cdetect(open).unwrap_err();
        assert!(err.contains("Could not open file `/dev/i2c-1'"), "{err}");
        assert!(err.contains("No such file or directory"), "{err}");

        let denied = "Error: Could not open file `/dev/i2c-1' or `/dev/i2c/1': Permission denied";
        assert!(parse_i2cdetect(denied)
            .unwrap_err()
            .contains("Permission denied"));

        let not_found = "bash: i2cdetect: command not found\n";
        assert!(parse_i2cdetect(not_found)
            .unwrap_err()
            .contains("command not found"));
    }

    #[test]
    fn empty_output_and_a_broken_header_are_errors() {
        assert!(parse_i2cdetect("").is_err());
        assert!(parse_i2cdetect("  \n\n").is_err());
        // Header with a missing column, one that is out of order and one with digits run together.
        for header in [
            "     0  1  2  3  4  5  6  7  8  9  a  b  c  d  e",
            "     0  1  2  3  4  5  6  7  8  9  a  b  c  d  f  e",
            "     0  1  2  3  4  5  6  7  8  9  a  b  c  d  e  ff",
            "     0  1  2  3  4  5  6  7  8  9  a  b  c  d  e  f  0",
            "0 1 2 3 4 5 6 7 8 9 a b c d e f",
        ] {
            let text = example_with_line(0, header);
            assert!(parse_i2cdetect(&text).is_err(), "{header}");
        }
    }

    #[test]
    fn a_header_without_rows_is_an_error() {
        let err = parse_i2cdetect(EXAMPLE[0]).unwrap_err();
        assert!(err.contains("no rows"), "{err}");
    }

    #[test]
    fn a_cell_that_does_not_match_its_column_is_an_error() {
        // 0x28 printed in the 0x27 column.
        let text = example_with_line(3, "20: -- -- -- -- -- -- -- 28 -- -- -- -- -- -- -- -- ");
        let err = parse_i2cdetect(&text).unwrap_err();
        assert!(err.contains("28") && err.contains("27"), "{err}");

        // 0x27 printed in the wrong row and in the wrong column.
        let text = example_with_line(4, "30: -- -- -- -- -- -- -- 27 -- -- -- -- -- -- -- -- ");
        assert!(parse_i2cdetect(&text).is_err());
        let text = example_with_line(3, "20: -- -- -- -- -- -- -- -- 27 -- -- -- -- -- -- -- ");
        assert!(parse_i2cdetect(&text).is_err());
    }

    #[test]
    fn malformed_rows_are_errors() {
        let cases = [
            (
                "one-character cell",
                "20: -- -- -- -- -- -- -- 2  -- -- -- -- -- -- -- -- ",
            ),
            (
                "non-hex cell",
                "20: -- -- -- -- -- -- -- x- -- -- -- -- -- -- -- -- ",
            ),
            (
                "half a claim",
                "20: -- -- -- -- -- -- -- U- -- -- -- -- -- -- -- -- ",
            ),
            (
                "lowercase claim",
                "20: -- -- -- -- -- -- -- uu -- -- -- -- -- -- -- -- ",
            ),
            (
                "sign in a cell",
                "20: -- -- -- -- -- -- -- +7 -- -- -- -- -- -- -- -- ",
            ),
            (
                "non-ascii cell",
                "20: -- -- -- -- -- -- -- é7 -- -- -- -- -- -- -- -- ",
            ),
            (
                "wide cell",
                "20: -- -- -- -- -- -- -- --- -- -- -- -- -- -- -- ",
            ),
            (
                "row shifted right",
                "20:  -- -- -- -- -- -- -- 27 -- -- -- -- -- -- -- --",
            ),
            (
                "row shifted left",
                "20:-- -- -- -- -- -- -- 27 -- -- -- -- -- -- -- -- ",
            ),
            (
                "junk after the last cell",
                "20: -- -- -- -- -- -- -- 27 -- -- -- -- -- -- -- -- extra",
            ),
            (
                "no label",
                " -- -- -- -- -- -- -- -- 27 -- -- -- -- -- -- -- ",
            ),
            (
                "label without colon",
                "20 -- -- -- -- -- -- -- 27 -- -- -- -- -- -- -- -- ",
            ),
            (
                "short label",
                "2: -- -- -- -- -- -- -- 27 -- -- -- -- -- -- -- -- ",
            ),
            (
                "label not a row start",
                "21: -- -- -- -- -- -- -- 27 -- -- -- -- -- -- -- -- ",
            ),
            (
                "label not hex",
                "g0: -- -- -- -- -- -- -- 27 -- -- -- -- -- -- -- -- ",
            ),
            (
                "row beyond 7-bit addresses",
                "80: -- -- -- -- -- -- -- -- -- -- -- -- -- -- -- -- ",
            ),
            (
                "repeated row",
                "10: -- -- -- -- -- -- -- -- -- -- -- -- -- -- -- -- ",
            ),
            (
                "rows out of order",
                "00: -- -- -- -- -- -- -- -- -- -- -- -- -- -- -- -- ",
            ),
            ("stray text row", "Segmentation fault"),
        ];
        for (name, line) in cases {
            // Row 20 is replaced; the repeated/out-of-order cases replace a later row.
            let index = if name == "repeated row" || name == "rows out of order" {
                4
            } else {
                3
            };
            let text = example_with_line(index, line);
            assert!(parse_i2cdetect(&text).is_err(), "{name}: {line:?}");
        }
    }

    #[test]
    fn text_after_the_grid_is_an_error() {
        let text = format!("{}Done.\n", example());
        let err = parse_i2cdetect(&text).unwrap_err();
        assert!(err.contains("Done."), "{err}");
    }

    #[test]
    fn the_command_names_the_bus() {
        assert_eq!(i2cdetect_command(1), Ok("i2cdetect -y 1".to_string()));
        assert_eq!(i2cdetect_command(0), Ok("i2cdetect -y 0".to_string()));
        assert_eq!(i2cdetect_command(31), Ok("i2cdetect -y 31".to_string()));
    }

    #[test]
    fn buses_beyond_31_are_refused() {
        for bus in [32, 33, 100, 255] {
            let err = i2cdetect_command(bus).unwrap_err();
            assert!(err.contains(&bus.to_string()), "{err}");
        }
    }
}

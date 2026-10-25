export const PIN_TYPES = {
  power5v: { label: '5V Power', color: '#EF4444', bg: 'bg-pin-power5v' },
  power3v3: { label: '3.3V Power', color: '#F97316', bg: 'bg-pin-power3v3' },
  ground: { label: 'Ground', color: '#1E293B', bg: 'bg-pin-ground' },
  gpio: { label: 'GPIO', color: '#22C55E', bg: 'bg-pin-gpio' },
  i2c: { label: 'I2C', color: '#3B82F6', bg: 'bg-pin-i2c' },
  spi: { label: 'SPI', color: '#A855F7', bg: 'bg-pin-spi' },
  uart: { label: 'UART', color: '#EC4899', bg: 'bg-pin-uart' },
  pcm: { label: 'PCM/I2S', color: '#14B8A6', bg: 'bg-pin-pcm' },
  eeprom: { label: 'EEPROM', color: '#F59E0B', bg: 'bg-pin-eeprom' }
}

// The Raspberry Pi 5 40-pin header, for the Pinout page and the breadboard pin glyphs.
// Sources (docs/v2/AUDIT.md, "Pin data"); data/pins.test.ts checks every field against them:
//  - physical pin, name, BCM number, type and typical function: the Raspberry Pi GPIO
//    documentation (content/controllers/pi5-header.json is generated from it)
//  - alternate functions: the RP1 peripherals datasheet, Table 4 "GPIO function" (RP1 has no SMI)
//  - wiringPi: WiringPi's own pin table (wiringPi.c, pinToGpioR2); a library convention
// physical: board pin number (1-40)
// bcm: Broadcom GPIO number (null for power/ground)
// wiringPi: WiringPi library number (null for non-GPIO)
// name: display name (GPIOn for the official GPn; ID_SD and ID_SC for the HAT ID pins)
// type: colour category, by the first protocol the official typical function names
// altFunctions: RP1 peripheral functions a0-a4 and a8 (a5-a7 are SYS_RIO, PROC_RIO and PIO on every GPIO)
// description: the official typical function, with RP1 function names
export const PINS = [
  {
    physical: 1,
    bcm: null,
    wiringPi: null,
    name: '3V3',
    type: 'power3v3',
    altFunctions: [],
    description: '3.3 V power output to attached peripherals.'
  },
  {
    physical: 2,
    bcm: null,
    wiringPi: null,
    name: '5V',
    type: 'power5v',
    altFunctions: [],
    description:
      '5 V power: an output to peripherals, or an input that powers the Raspberry Pi (for example through a PoE+ HAT or third-party HAT).'
  },
  {
    physical: 3,
    bcm: 2,
    wiringPi: 8,
    name: 'GPIO2',
    type: 'i2c',
    altFunctions: [
      'SPI0_CSn[3]',
      'DPI_VSYNC',
      'UART1_CTS',
      'I2C1_SDA',
      'UART0_IR_RX',
      'SPI2_SIO[0]'
    ],
    description: 'I2C1 data line (SDA). Fixed 1.8 kΩ on-board pull-up resistor to 3.3 V.'
  },
  {
    physical: 4,
    bcm: null,
    wiringPi: null,
    name: '5V',
    type: 'power5v',
    altFunctions: [],
    description:
      '5 V power: an output to peripherals, or an input that powers the Raspberry Pi (for example through a PoE+ HAT or third-party HAT).'
  },
  {
    physical: 5,
    bcm: 3,
    wiringPi: 9,
    name: 'GPIO3',
    type: 'i2c',
    altFunctions: ['SPI0_CSn[2]', 'DPI_HSYNC', 'UART1_RTS', 'I2C1_SCL', 'UART0_IR_TX', 'SPI2_SCLK'],
    description: 'I2C1 clock line (SCL). Fixed 1.8 kΩ on-board pull-up resistor to 3.3 V.'
  },
  {
    physical: 6,
    bcm: null,
    wiringPi: null,
    name: 'GND',
    type: 'ground',
    altFunctions: [],
    description: 'Ground (0 V). Completes an electrical circuit connected to power.'
  },
  {
    physical: 7,
    bcm: 4,
    wiringPi: 7,
    name: 'GPIO4',
    type: 'gpio',
    altFunctions: ['GPCLK[0]', 'DPI_D[0]', 'UART2_TX', 'I2C2_SDA', 'UART0_RI', 'SPI3_CSn[0]'],
    description: 'Clock output (GPCLK0).'
  },
  {
    physical: 8,
    bcm: 14,
    wiringPi: 15,
    name: 'GPIO14',
    type: 'uart',
    altFunctions: ['PWM0[2]', 'DPI_D[10]', 'UART4_CTS', 'I2C3_SDA', 'UART0_TX', 'SPI5_SIO[0]'],
    description:
      'UART transmit data (TXD, UART0_TX). UART0 is disabled by default on Raspberry Pi 5; the default serial console is the dedicated debug header.'
  },
  {
    physical: 9,
    bcm: null,
    wiringPi: null,
    name: 'GND',
    type: 'ground',
    altFunctions: [],
    description: 'Ground (0 V). Completes an electrical circuit connected to power.'
  },
  {
    physical: 10,
    bcm: 15,
    wiringPi: 16,
    name: 'GPIO15',
    type: 'uart',
    altFunctions: ['PWM0[3]', 'DPI_D[11]', 'UART4_RTS', 'I2C3_SCL', 'UART0_RX', 'SPI5_SCLK'],
    description:
      'UART receive data (RXD, UART0_RX). UART0 is disabled by default on Raspberry Pi 5; the default serial console is the dedicated debug header.'
  },
  {
    physical: 11,
    bcm: 17,
    wiringPi: 0,
    name: 'GPIO17',
    type: 'spi',
    altFunctions: ['SPI1_CSn[1]', 'DPI_D[13]', 'UART0_RTS'],
    description: 'SPI chip enable CE1 (SPI1_CSn[1]).'
  },
  {
    physical: 12,
    bcm: 18,
    wiringPi: 1,
    name: 'GPIO18',
    type: 'pcm',
    altFunctions: ['SPI1_CSn[0]', 'DPI_D[14]', 'I2S0_SCLK', 'PWM0[2]', 'I2S1_SCLK', 'GPCLK[1]'],
    description: 'PCM clock, or SPI chip enable CE0 (SPI1_CSn[0]).'
  },
  {
    physical: 13,
    bcm: 27,
    wiringPi: 2,
    name: 'GPIO27',
    type: 'gpio',
    altFunctions: [
      'SDIO0_DAT[3]',
      'DPI_D[23]',
      'I2S0_SDO[3]',
      'AUDIO_IN_DAT1',
      'I2S1_SDO[3]',
      'SPI1_CSn[1]'
    ],
    description: 'General-purpose I/O.'
  },
  {
    physical: 14,
    bcm: null,
    wiringPi: null,
    name: 'GND',
    type: 'ground',
    altFunctions: [],
    description: 'Ground (0 V). Completes an electrical circuit connected to power.'
  },
  {
    physical: 15,
    bcm: 22,
    wiringPi: 3,
    name: 'GPIO22',
    type: 'gpio',
    altFunctions: ['SDIO0_CLK', 'DPI_D[18]', 'I2S0_SDI[1]', 'I2C3_SDA', 'I2S1_SDI[1]'],
    description: 'General-purpose I/O.'
  },
  {
    physical: 16,
    bcm: 23,
    wiringPi: 4,
    name: 'GPIO23',
    type: 'gpio',
    altFunctions: ['SDIO0_CMD', 'DPI_D[19]', 'I2S0_SDO[1]', 'I2C3_SCL', 'I2S1_SDO[1]'],
    description: 'General-purpose I/O.'
  },
  {
    physical: 17,
    bcm: null,
    wiringPi: null,
    name: '3V3',
    type: 'power3v3',
    altFunctions: [],
    description: '3.3 V power output to attached peripherals.'
  },
  {
    physical: 18,
    bcm: 24,
    wiringPi: 5,
    name: 'GPIO24',
    type: 'gpio',
    altFunctions: ['SDIO0_DAT[0]', 'DPI_D[20]', 'I2S0_SDI[2]', 'I2S1_SDI[2]', 'SPI2_CSn[1]'],
    description: 'General-purpose I/O.'
  },
  {
    physical: 19,
    bcm: 10,
    wiringPi: 12,
    name: 'GPIO10',
    type: 'spi',
    altFunctions: ['SPI0_SIO[0]', 'DPI_D[6]', 'UART3_CTS', 'I2C1_SDA'],
    description: 'SPI0 MOSI: sends data from the Raspberry Pi to an SPI device (SPI0_SIO[0]).'
  },
  {
    physical: 20,
    bcm: null,
    wiringPi: null,
    name: 'GND',
    type: 'ground',
    altFunctions: [],
    description: 'Ground (0 V). Completes an electrical circuit connected to power.'
  },
  {
    physical: 21,
    bcm: 9,
    wiringPi: 13,
    name: 'GPIO9',
    type: 'spi',
    altFunctions: ['SPI0_SIO[1]', 'DPI_D[5]', 'UART3_RX', 'I2C0_SCL'],
    description: 'SPI0 MISO: receives data from an SPI device (SPI0_SIO[1]).'
  },
  {
    physical: 22,
    bcm: 25,
    wiringPi: 6,
    name: 'GPIO25',
    type: 'gpio',
    altFunctions: [
      'SDIO0_DAT[1]',
      'DPI_D[21]',
      'I2S0_SDO[2]',
      'AUDIO_IN_CLK',
      'I2S1_SDO[2]',
      'SPI3_CSn[1]'
    ],
    description: 'General-purpose I/O.'
  },
  {
    physical: 23,
    bcm: 11,
    wiringPi: 14,
    name: 'GPIO11',
    type: 'spi',
    altFunctions: ['SPI0_SCLK', 'DPI_D[7]', 'UART3_RTS', 'I2C1_SCL', 'SPI4_SCLK'],
    description: 'SPI0 serial clock (SCLK).'
  },
  {
    physical: 24,
    bcm: 8,
    wiringPi: 10,
    name: 'GPIO8',
    type: 'spi',
    altFunctions: ['SPI0_CSn[0]', 'DPI_D[4]', 'UART3_TX', 'I2C0_SDA', 'SPI4_CSn[0]'],
    description: 'SPI0 chip enable CE0 (SPI0_CSn[0]).'
  },
  {
    physical: 25,
    bcm: null,
    wiringPi: null,
    name: 'GND',
    type: 'ground',
    altFunctions: [],
    description: 'Ground (0 V). Completes an electrical circuit connected to power.'
  },
  {
    physical: 26,
    bcm: 7,
    wiringPi: 11,
    name: 'GPIO7',
    type: 'spi',
    altFunctions: ['SPI0_CSn[1]', 'DPI_D[3]', 'UART2_RTS', 'I2C3_SCL', 'UART0_DSR', 'SPI3_SCLK'],
    description: 'SPI0 chip enable CE1 (SPI0_CSn[1]).'
  },
  {
    physical: 27,
    bcm: 0,
    wiringPi: 30,
    name: 'ID_SD',
    type: 'eeprom',
    altFunctions: ['SPI0_SIO[3]', 'DPI_PCLK', 'UART1_TX', 'I2C0_SDA', 'SPI2_CSn[0]'],
    description:
      'ID_SD: I2C data line used to identify a HAT. Reserved for HAT identification; not for general I/O.'
  },
  {
    physical: 28,
    bcm: 1,
    wiringPi: 31,
    name: 'ID_SC',
    type: 'eeprom',
    altFunctions: ['SPI0_SIO[2]', 'DPI_DE', 'UART1_RX', 'I2C0_SCL', 'SPI2_SIO[1]'],
    description:
      'ID_SC: I2C clock line used to identify a HAT. Reserved for HAT identification; not for general I/O.'
  },
  {
    physical: 29,
    bcm: 5,
    wiringPi: 21,
    name: 'GPIO5',
    type: 'gpio',
    altFunctions: ['GPCLK[1]', 'DPI_D[1]', 'UART2_RX', 'I2C2_SCL', 'UART0_DTR', 'SPI3_SIO[1]'],
    description: 'General-purpose I/O.'
  },
  {
    physical: 30,
    bcm: null,
    wiringPi: null,
    name: 'GND',
    type: 'ground',
    altFunctions: [],
    description: 'Ground (0 V). Completes an electrical circuit connected to power.'
  },
  {
    physical: 31,
    bcm: 6,
    wiringPi: 22,
    name: 'GPIO6',
    type: 'gpio',
    altFunctions: ['GPCLK[2]', 'DPI_D[2]', 'UART2_CTS', 'I2C3_SDA', 'UART0_DCD', 'SPI3_SIO[0]'],
    description: 'General-purpose I/O.'
  },
  {
    physical: 32,
    bcm: 12,
    wiringPi: 26,
    name: 'GPIO12',
    type: 'gpio',
    altFunctions: ['PWM0[0]', 'DPI_D[8]', 'UART4_TX', 'I2C2_SDA', 'AUDIO_OUT_L', 'SPI5_CSn[0]'],
    description: 'PWM output, channel 0 (PWM0[0]).'
  },
  {
    physical: 33,
    bcm: 13,
    wiringPi: 23,
    name: 'GPIO13',
    type: 'gpio',
    altFunctions: ['PWM0[1]', 'DPI_D[9]', 'UART4_RX', 'I2C2_SCL', 'AUDIO_OUT_R', 'SPI5_SIO[1]'],
    description: 'PWM output, channel 1 (PWM0[1]).'
  },
  {
    physical: 34,
    bcm: null,
    wiringPi: null,
    name: 'GND',
    type: 'ground',
    altFunctions: [],
    description: 'Ground (0 V). Completes an electrical circuit connected to power.'
  },
  {
    physical: 35,
    bcm: 19,
    wiringPi: 24,
    name: 'GPIO19',
    type: 'pcm',
    altFunctions: ['SPI1_SIO[1]', 'DPI_D[15]', 'I2S0_WS', 'PWM0[3]', 'I2S1_WS'],
    description: 'PCM frame sync (PCM_FS), or SPI1 MISO (SPI1_SIO[1]).'
  },
  {
    physical: 36,
    bcm: 16,
    wiringPi: 27,
    name: 'GPIO16',
    type: 'spi',
    altFunctions: ['SPI1_CSn[2]', 'DPI_D[12]', 'UART0_CTS'],
    description: 'SPI chip enable CE2 (SPI1_CSn[2]).'
  },
  {
    physical: 37,
    bcm: 26,
    wiringPi: 25,
    name: 'GPIO26',
    type: 'gpio',
    altFunctions: [
      'SDIO0_DAT[2]',
      'DPI_D[22]',
      'I2S0_SDI[3]',
      'AUDIO_IN_DAT0',
      'I2S1_SDI[3]',
      'SPI5_CSn[1]'
    ],
    description: 'General-purpose I/O.'
  },
  {
    physical: 38,
    bcm: 20,
    wiringPi: 28,
    name: 'GPIO20',
    type: 'pcm',
    altFunctions: ['SPI1_SIO[0]', 'DPI_D[16]', 'I2S0_SDI[0]', 'GPCLK[0]', 'I2S1_SDI[0]'],
    description: 'PCM audio data in (PCM_DIN).'
  },
  {
    physical: 39,
    bcm: null,
    wiringPi: null,
    name: 'GND',
    type: 'ground',
    altFunctions: [],
    description: 'Ground (0 V). Completes an electrical circuit connected to power.'
  },
  {
    physical: 40,
    bcm: 21,
    wiringPi: 29,
    name: 'GPIO21',
    type: 'pcm',
    altFunctions: ['SPI1_SCLK', 'DPI_D[17]', 'I2S0_SDO[0]', 'GPCLK[1]', 'I2S1_SDO[0]'],
    description: 'PCM audio data out (PCM_DOUT).'
  }
]

// All unique pin types
export const ALL_PIN_TYPES = [...new Set(PINS.map((p) => p.type))]

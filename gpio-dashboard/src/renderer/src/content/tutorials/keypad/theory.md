## How it works

A 4 by 4 keypad has 16 keys but only eight wires. Each key is a switch between one row line and one column line, so pressing a key joins its row to its column. The four rows, R1 to R4, are on {{net KP1.R1}}, {{net KP1.R2}}, {{net KP1.R3}} and {{net KP1.R4}}. The four columns, C1 to C4, are on {{net KP1.C1}}, {{net KP1.C2}}, {{net KP1.C3}} and {{net KP1.C4}}.

## Scanning

The code makes the rows outputs and the columns inputs with pull-down resistors turned on. Then it raises one row at a time to HIGH and reads all four columns:

- If no key in that row is pressed, every column stays LOW through its pull-down.
- If a key in that row is pressed, it connects the row to its column, and that column reads HIGH.

The row that is raised and the column that reads HIGH together name the key. A pressed key has a resistance of about 60 to 90 Ω, much lower than the Pi's pull-down of tens of kΩ, so the column reads clearly HIGH.

Rows 1 to 4 give the keys 1 2 3 A, 4 5 6 B, 7 8 9 C and * 0 # D.

## What the keypad does not have

The keypad contains no diodes and no resistors. The pull-downs come from the Pi. Pressing three keys at once can make a fourth appear to be pressed, because current can flow through the keys in a loop. For one key at a time that never matters.

The code waits 50 ms between scans, which also hides contact bounce, and only prints a key when it changes.

## The leads

The keypad's connector is a row of eight female sockets, so the leads that plug into it are male at both ends. Each one goes from a T-board strip straight into a socket.

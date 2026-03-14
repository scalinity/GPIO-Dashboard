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

// Complete Raspberry Pi 5 40-pin header
// physical: board pin number (1-40)
// bcm: Broadcom GPIO number (null for power/ground)
// wiringPi: WiringPi library number (null for non-GPIO)
// name: display name
// type: primary function category
// altFunctions: array of alternate functions
// description: human-readable description
export const PINS = [
  {
    physical: 1,
    bcm: null,
    wiringPi: null,
    name: '3V3',
    type: 'power3v3',
    altFunctions: [],
    description: '3.3V power supply. Max 500mA shared across all 3.3V pins.'
  },
  {
    physical: 2,
    bcm: null,
    wiringPi: null,
    name: '5V',
    type: 'power5v',
    altFunctions: [],
    description: '5V power supply directly from USB-C input.'
  },
  {
    physical: 3,
    bcm: 2,
    wiringPi: 8,
    name: 'GPIO2',
    type: 'i2c',
    altFunctions: ['SDA1', 'SMI SA3'],
    description: 'I2C1 Data. Has 1.8kΩ pull-up to 3.3V. Used for HATs, sensors, displays.'
  },
  {
    physical: 4,
    bcm: null,
    wiringPi: null,
    name: '5V',
    type: 'power5v',
    altFunctions: [],
    description: '5V power supply directly from USB-C input.'
  },
  {
    physical: 5,
    bcm: 3,
    wiringPi: 9,
    name: 'GPIO3',
    type: 'i2c',
    altFunctions: ['SCL1', 'SMI SA2'],
    description: 'I2C1 Clock. Has 1.8kΩ pull-up to 3.3V. Used for HATs, sensors, displays.'
  },
  {
    physical: 6,
    bcm: null,
    wiringPi: null,
    name: 'GND',
    type: 'ground',
    altFunctions: [],
    description: 'Ground reference. All ground pins are connected internally.'
  },
  {
    physical: 7,
    bcm: 4,
    wiringPi: 7,
    name: 'GPIO4',
    type: 'gpio',
    altFunctions: ['GPCLK0', 'SMI SA1'],
    description: 'General purpose GPIO. Default: GPCLK0 (general purpose clock).'
  },
  {
    physical: 8,
    bcm: 14,
    wiringPi: 15,
    name: 'GPIO14',
    type: 'uart',
    altFunctions: ['TXD0', 'SMI SD6'],
    description: 'UART0 Transmit. Serial console output by default (disable in raspi-config).'
  },
  {
    physical: 9,
    bcm: null,
    wiringPi: null,
    name: 'GND',
    type: 'ground',
    altFunctions: [],
    description: 'Ground reference.'
  },
  {
    physical: 10,
    bcm: 15,
    wiringPi: 16,
    name: 'GPIO15',
    type: 'uart',
    altFunctions: ['RXD0', 'SMI SD7'],
    description: 'UART0 Receive. Serial console input by default.'
  },
  {
    physical: 11,
    bcm: 17,
    wiringPi: 0,
    name: 'GPIO17',
    type: 'gpio',
    altFunctions: ['FL1', 'SMI SD9'],
    description: 'General purpose GPIO. Commonly used for LEDs and buttons in tutorials.'
  },
  {
    physical: 12,
    bcm: 18,
    wiringPi: 1,
    name: 'GPIO18',
    type: 'pcm',
    altFunctions: ['PCM_CLK', 'SMI SD10', 'PWM0_0'],
    description: 'PCM Clock / PWM0 Channel 0. Hardware PWM capable.'
  },
  {
    physical: 13,
    bcm: 27,
    wiringPi: 2,
    name: 'GPIO27',
    type: 'gpio',
    altFunctions: ['SD0_DAT3', 'TE1'],
    description: 'General purpose GPIO.'
  },
  {
    physical: 14,
    bcm: null,
    wiringPi: null,
    name: 'GND',
    type: 'ground',
    altFunctions: [],
    description: 'Ground reference.'
  },
  {
    physical: 15,
    bcm: 22,
    wiringPi: 3,
    name: 'GPIO22',
    type: 'gpio',
    altFunctions: ['SD0_CLK', 'SMI SD14'],
    description: 'General purpose GPIO.'
  },
  {
    physical: 16,
    bcm: 23,
    wiringPi: 4,
    name: 'GPIO23',
    type: 'gpio',
    altFunctions: ['SD0_CMD', 'SMI SD15'],
    description: 'General purpose GPIO.'
  },
  {
    physical: 17,
    bcm: null,
    wiringPi: null,
    name: '3V3',
    type: 'power3v3',
    altFunctions: [],
    description: '3.3V power supply.'
  },
  {
    physical: 18,
    bcm: 24,
    wiringPi: 5,
    name: 'GPIO24',
    type: 'gpio',
    altFunctions: ['SD0_DAT0', 'SMI SD16'],
    description: 'General purpose GPIO.'
  },
  {
    physical: 19,
    bcm: 10,
    wiringPi: 12,
    name: 'GPIO10',
    type: 'spi',
    altFunctions: ['SPI0_MOSI', 'SMI SD2'],
    description: 'SPI0 Main Out Sub In. Used for SPI communication.'
  },
  {
    physical: 20,
    bcm: null,
    wiringPi: null,
    name: 'GND',
    type: 'ground',
    altFunctions: [],
    description: 'Ground reference.'
  },
  {
    physical: 21,
    bcm: 9,
    wiringPi: 13,
    name: 'GPIO9',
    type: 'spi',
    altFunctions: ['SPI0_MISO', 'SMI SD1'],
    description: 'SPI0 Main In Sub Out.'
  },
  {
    physical: 22,
    bcm: 25,
    wiringPi: 6,
    name: 'GPIO25',
    type: 'gpio',
    altFunctions: ['SD0_DAT1', 'SMI SD17'],
    description: 'General purpose GPIO.'
  },
  {
    physical: 23,
    bcm: 11,
    wiringPi: 14,
    name: 'GPIO11',
    type: 'spi',
    altFunctions: ['SPI0_SCLK', 'SMI SD3'],
    description: 'SPI0 Clock.'
  },
  {
    physical: 24,
    bcm: 8,
    wiringPi: 10,
    name: 'GPIO8',
    type: 'spi',
    altFunctions: ['SPI0_CE0', 'SMI SD0'],
    description: 'SPI0 Chip Enable 0.'
  },
  {
    physical: 25,
    bcm: null,
    wiringPi: null,
    name: 'GND',
    type: 'ground',
    altFunctions: [],
    description: 'Ground reference.'
  },
  {
    physical: 26,
    bcm: 7,
    wiringPi: 11,
    name: 'GPIO7',
    type: 'spi',
    altFunctions: ['SPI0_CE1', 'SMI SWE_N'],
    description: 'SPI0 Chip Enable 1.'
  },
  {
    physical: 27,
    bcm: 0,
    wiringPi: 30,
    name: 'ID_SD',
    type: 'eeprom',
    altFunctions: ['I2C0_SDA', 'ID_SD'],
    description: 'HAT EEPROM I2C Data. Reserved for HAT identification. Do not use for general I/O.'
  },
  {
    physical: 28,
    bcm: 1,
    wiringPi: 31,
    name: 'ID_SC',
    type: 'eeprom',
    altFunctions: ['I2C0_SCL', 'ID_SC'],
    description: 'HAT EEPROM I2C Clock. Reserved for HAT identification. Do not use for general I/O.'
  },
  {
    physical: 29,
    bcm: 5,
    wiringPi: 21,
    name: 'GPIO5',
    type: 'gpio',
    altFunctions: ['GPCLK1', 'SMI SA0'],
    description: 'General purpose GPIO.'
  },
  {
    physical: 30,
    bcm: null,
    wiringPi: null,
    name: 'GND',
    type: 'ground',
    altFunctions: [],
    description: 'Ground reference.'
  },
  {
    physical: 31,
    bcm: 6,
    wiringPi: 22,
    name: 'GPIO6',
    type: 'gpio',
    altFunctions: ['GPCLK2', 'SMI SOE_N'],
    description: 'General purpose GPIO.'
  },
  {
    physical: 32,
    bcm: 12,
    wiringPi: 26,
    name: 'GPIO12',
    type: 'gpio',
    altFunctions: ['PWM0_0', 'SMI SD4'],
    description: 'General purpose GPIO. Alternate: PWM0 Channel 0.'
  },
  {
    physical: 33,
    bcm: 13,
    wiringPi: 23,
    name: 'GPIO13',
    type: 'gpio',
    altFunctions: ['PWM0_1', 'SMI SD5'],
    description: 'General purpose GPIO. Alternate: PWM0 Channel 1.'
  },
  {
    physical: 34,
    bcm: null,
    wiringPi: null,
    name: 'GND',
    type: 'ground',
    altFunctions: [],
    description: 'Ground reference.'
  },
  {
    physical: 35,
    bcm: 19,
    wiringPi: 24,
    name: 'GPIO19',
    type: 'pcm',
    altFunctions: ['PCM_FS', 'SMI SD11', 'PWM0_1'],
    description: 'PCM Frame Sync / PWM0 Channel 1.'
  },
  {
    physical: 36,
    bcm: 16,
    wiringPi: 27,
    name: 'GPIO16',
    type: 'gpio',
    altFunctions: ['FL0', 'SMI SD8'],
    description: 'General purpose GPIO.'
  },
  {
    physical: 37,
    bcm: 26,
    wiringPi: 25,
    name: 'GPIO26',
    type: 'gpio',
    altFunctions: ['SD0_DAT2', 'TE0'],
    description: 'General purpose GPIO.'
  },
  {
    physical: 38,
    bcm: 20,
    wiringPi: 28,
    name: 'GPIO20',
    type: 'pcm',
    altFunctions: ['PCM_DIN', 'SMI SD12'],
    description: 'PCM Data In.'
  },
  {
    physical: 39,
    bcm: null,
    wiringPi: null,
    name: 'GND',
    type: 'ground',
    altFunctions: [],
    description: 'Ground reference.'
  },
  {
    physical: 40,
    bcm: 21,
    wiringPi: 29,
    name: 'GPIO21',
    type: 'pcm',
    altFunctions: ['PCM_DOUT', 'SMI SD13'],
    description: 'PCM Data Out.'
  }
]

// Helper: get pin by physical number
export function getPinByPhysical(num) {
  return PINS.find((p) => p.physical === num)
}

// Helper: get pin by BCM number
export function getPinByBCM(bcm) {
  return PINS.find((p) => p.bcm === bcm)
}

// Helper: get all GPIO-capable pins
export function getGpioPins() {
  return PINS.filter((p) => p.bcm !== null)
}

// Helper: get pins by type
export function getPinsByType(type) {
  return PINS.filter((p) => p.type === type)
}

// All unique pin types
export const ALL_PIN_TYPES = [...new Set(PINS.map((p) => p.type))]

import Store from 'electron-store'

const schema = {
  connection: {
    type: 'object',
    properties: {
      host: { type: 'string', default: '' },
      port: { type: 'number', default: 22 },
      username: { type: 'string', default: 'pi' },
      password: { type: 'string', default: '' }
    },
    default: {}
  },
  ui: {
    type: 'object',
    properties: {
      lastTab: { type: 'string', default: 'gpio' },
      terminalHeight: { type: 'number', default: 300 },
      completedTutorials: { type: 'array', items: { type: 'string' }, default: [] }
    },
    default: {}
  }
}

const defaults = {
  connection: {
    host: '',
    port: 22,
    username: 'pi',
    password: ''
  },
  ui: {
    lastTab: 'gpio',
    terminalHeight: 300,
    completedTutorials: []
  }
}

const store = new Store({ schema, defaults })

export default store

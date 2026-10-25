import { afterEach, describe, expect, it } from 'vitest'
import { exportProject, importProject, listProjects, readProject } from './projects'
import { i2cScan } from './ssh'

function install(api: unknown) {
  ;(globalThis as { window?: unknown }).window = { api }
}

afterEach(() => {
  delete (globalThis as { window?: unknown }).window
})

describe('native wrappers', () => {
  it('unwrap successes and turn structured failures into exceptions', async () => {
    install({
      projects: {
        list: async () => ({ success: true, projects: [{ id: 'a', name: 'A', updated: 'x' }] }),
        read: async () => ({ success: false, error: 'Project not found' })
      }
    })
    expect(await listProjects()).toEqual([{ id: 'a', name: 'A', updated: 'x' }])
    await expect(readProject('nope')).rejects.toThrow('Project not found')
  })

  it('report a canceled dialog as null', async () => {
    install({
      projects: {
        export: async () => ({ canceled: true }),
        import: async () => ({ canceled: true })
      }
    })
    expect(await exportProject({})).toBeNull()
    expect(await importProject()).toBeNull()
  })

  it('pass the bus number through for an I2C scan', async () => {
    const buses: number[] = []
    install({
      ssh: {
        i2cScan: async (bus: number) => {
          buses.push(bus)
          return { success: true, devices: [{ address: 0x27, claimed: false }] }
        }
      }
    })
    expect(await i2cScan()).toEqual([{ address: 0x27, claimed: false }])
    expect(buses).toEqual([1])
  })

  it('fail clearly outside the app window', async () => {
    await expect(listProjects()).rejects.toThrow('only available in the app window')
  })
})

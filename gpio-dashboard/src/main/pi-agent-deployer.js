import { app } from 'electron'
import path from 'path'
import fs from 'fs'

class PiAgentDeployer {
  _getAgentDir() {
    const devPath = path.join(app.getAppPath(), 'pi-agent')
    if (fs.existsSync(devPath)) return devPath
    const resourcePath = path.join(process.resourcesPath, 'pi-agent')
    if (fs.existsSync(resourcePath)) return resourcePath
    throw new Error('Pi agent directory not found in app or resources path')
  }

  _getRemoteDir(sshManager) {
    if (!sshManager.config?.username) {
      throw new Error('SSH manager has no configured username')
    }
    const user = sshManager.config.username
    if (!/^[a-zA-Z0-9_-]+$/.test(user)) {
      throw new Error('Invalid SSH username')
    }
    return `/home/${user}/gpio-dashboard-agent`
  }

  async deploy(sshManager) {
    const agentDir = this._getAgentDir()
    const remoteDir = this._getRemoteDir(sshManager)

    await sshManager.execute(`mkdir -p '${remoteDir}'`)

    const entries = fs.readdirSync(agentDir)
    let uploadedCount = 0
    for (const file of entries) {
      const localPath = path.join(agentDir, file)
      const stat = fs.statSync(localPath)
      if (stat.isFile()) {
        await sshManager.scpPut(localPath, `${remoteDir}/${file}`)
        uploadedCount++
      }
    }

    return { success: true, files: uploadedCount }
  }

  async install(sshManager) {
    const remoteDir = this._getRemoteDir(sshManager)
    const result = await sshManager.execute(
      `cd '${remoteDir}' && chmod +x install.sh && bash install.sh`,
      { timeout: 300000 }
    )
    return { stdout: result.stdout, stderr: result.stderr, code: result.code }
  }

  async start(sshManager) {
    const remoteDir = this._getRemoteDir(sshManager)
    // Kill any existing agent, then start fresh with nohup so it survives SSH channel close
    await sshManager.execute(
      `pkill -f '${remoteDir}/agent.py' 2>/dev/null; sleep 0.5; exit 0`
    )
    await sshManager.execute(
      `cd '${remoteDir}' && nohup python3 agent.py > agent.log 2>&1 &`
    )
    // Wait and retry reading the auth token (agent may take a moment to start)
    let authToken = null
    for (let attempt = 0; attempt < 5; attempt++) {
      await new Promise((r) => setTimeout(r, 500))
      const logResult = await sshManager.execute(
        `head -5 '${remoteDir}/agent.log' 2>/dev/null; exit 0`
      )
      const match = logResult.stdout.match(/AUTH_TOKEN=(\S+)/)
      if (match) {
        authToken = match[1]
        // Scrub token from log file
        await sshManager.execute(`sed -i '/AUTH_TOKEN=/d' '${remoteDir}/agent.log' 2>/dev/null; exit 0`)
        break
      }
    }
    this.authToken = authToken
    return { success: true, authToken: this.authToken }
  }

  async stop(sshManager) {
    if (sshManager.status !== 'connected') return { success: true }
    const remoteDir = this._getRemoteDir(sshManager)
    await sshManager.execute(`pkill -f '${remoteDir}/agent.py' 2>/dev/null; exit 0`)
    return { success: true }
  }

  async getStatus(sshManager) {
    if (sshManager.status !== 'connected') return { running: false }
    const result = await sshManager.execute('ps aux | grep agent.py | grep -v grep')
    const running = result.stdout.trim().length > 0
    return { running }
  }
}

export default PiAgentDeployer

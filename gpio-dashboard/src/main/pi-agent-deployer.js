import { app } from 'electron'
import path from 'path'
import fs from 'fs'

class PiAgentDeployer {
  _getAgentDir() {
    const devPath = path.join(app.getAppPath(), 'pi-agent')
    if (fs.existsSync(devPath)) return devPath
    const resourcePath = path.join(process.resourcesPath, 'pi-agent')
    if (fs.existsSync(resourcePath)) return resourcePath
    return devPath
  }

  _getRemoteDir(sshManager) {
    const user = sshManager.config?.username || 'pi'
    return `/home/${user}/gpio-dashboard-agent`
  }

  async deploy(sshManager) {
    const agentDir = this._getAgentDir()
    const remoteDir = this._getRemoteDir(sshManager)

    await sshManager.execute(`mkdir -p ${remoteDir}`)

    const files = fs.readdirSync(agentDir)
    for (const file of files) {
      const localPath = path.join(agentDir, file)
      const stat = fs.statSync(localPath)
      if (stat.isFile()) {
        await sshManager.scpPut(localPath, `${remoteDir}/${file}`)
      }
    }

    return { success: true, files: files.length }
  }

  async install(sshManager) {
    const remoteDir = this._getRemoteDir(sshManager)
    const result = await sshManager.execute(
      `cd ${remoteDir} && chmod +x install.sh && bash install.sh`
    )
    return { stdout: result.stdout, stderr: result.stderr, code: result.code }
  }

  async start(sshManager) {
    const remoteDir = this._getRemoteDir(sshManager)
    await sshManager.execute(
      `cd ${remoteDir} && nohup python3 agent.py > agent.log 2>&1 &`
    )
    return { success: true }
  }

  async stop(sshManager) {
    await sshManager.execute("pkill -f 'python3.*agent\\.py'")
    return { success: true }
  }

  async getStatus(sshManager) {
    const result = await sshManager.execute('ps aux | grep agent.py | grep -v grep')
    const running = result.stdout.trim().length > 0
    return { running }
  }
}

export default PiAgentDeployer

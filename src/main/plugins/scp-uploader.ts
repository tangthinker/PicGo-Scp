import { IPicGo, IPluginConfig } from 'picgo'
import { Client } from 'ssh2'
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'

interface IScpConfig {
  host: string
  port: number
  username: string
  password?: string
  privateKey?: string
  remotePath: string
  customUrl?: string
}

class ScpUploader {
  private ctx: IPicGo

  constructor(ctx: IPicGo) {
    this.ctx = ctx
  }

  get name(): string {
    return 'SCP'
  }

  config(ctx: IPicGo): IPluginConfig[] {
    return [
      {
        name: 'host',
        type: 'input',
        default: '',
        required: true,
        message: 'SCP_HOST',
        alias: 'SCP_HOST'
      },
      {
        name: 'port',
        type: 'input',
        default: 22,
        required: true,
        message: 'SCP_PORT',
        alias: 'SCP_PORT'
      },
      {
        name: 'username',
        type: 'input',
        default: '',
        required: true,
        message: 'SCP_USERNAME',
        alias: 'SCP_USERNAME'
      },
      {
        name: 'password',
        type: 'input',
        default: '',
        required: false,
        message: 'SCP_PASSWORD',
        alias: 'SCP_PASSWORD'
      },
      {
        name: 'privateKey',
        type: 'input',
        default: path.join(os.homedir(), '.ssh', 'id_rsa'),
        required: false,
        message: 'SCP_PRIVATE_KEY',
        alias: 'SCP_PRIVATE_KEY'
      },
      {
        name: 'remotePath',
        type: 'input',
        default: '/var/www/html/images',
        required: true,
        message: 'SCP_REMOTE_PATH',
        alias: 'SCP_REMOTE_PATH'
      },
      {
        name: 'customUrl',
        type: 'input',
        default: '',
        required: false,
        message: 'SCP_CUSTOM_URL',
        alias: 'SCP_CUSTOM_URL'
      }
    ]
  }

  async handle(ctx: IPicGo): Promise<IPicGo> {
    const config = ctx.getConfig<IScpConfig>('picBed.scp')
    
    if (!config) {
      throw new Error('SCP配置未找到')
    }

    const { host, port, username, password, privateKey, remotePath, customUrl } = config

    if (!host || !username || !remotePath) {
      throw new Error('请配置主机地址、用户名和远程目录')
    }

    const client = new Client()

    try {
      await this.connectToServer(client, { host, port, username, password, privateKey, remotePath })
      
      for (const item of ctx.output) {
        const fileName = item.fileName || `image_${Date.now()}.${item.extname}`
        const remoteFilePath = path.join(remotePath, fileName)
        
        // 上传文件
        if (item.buffer) {
          await this.uploadFile(client, item.buffer, remoteFilePath)
          
          // 设置返回的URL
          if (customUrl) {
            item.imgUrl = `${customUrl}/${fileName}`
          } else {
            item.imgUrl = `http://${host}/${fileName}`
          }
          
          this.ctx.log.info(`SCP上传成功: ${item.imgUrl}`)
        }
      }
    } catch (error) {
      this.ctx.log.error('SCP上传失败:', error as any)
      throw error
    } finally {
      client.end()
    }

    return ctx
  }

  private async connectToServer(client: Client, config: IScpConfig): Promise<void> {
    return new Promise((resolve, reject) => {
      const connectConfig: any = {
        host: config.host,
        port: config.port,
        username: config.username
      }

      // 优先使用配置的私钥
      if (config.privateKey && config.privateKey.trim()) {
        try {
          connectConfig.privateKey = fs.readFileSync(config.privateKey)
        } catch (error) {
          reject(new Error(`无法读取私钥文件: ${config.privateKey}`))
          return
        }
      } else if (config.password && config.password.trim()) {
        // 使用密码认证
        connectConfig.password = config.password
      } else {
        // 尝试使用默认私钥文件
        const defaultPrivateKeys = [
          path.join(os.homedir(), '.ssh', 'id_rsa'),
          path.join(os.homedir(), '.ssh', 'id_ed25519'),
          path.join(os.homedir(), '.ssh', 'id_ecdsa'),
          path.join(os.homedir(), '.ssh', 'id_dsa')
        ]

        let privateKeyFound = false
        for (const keyPath of defaultPrivateKeys) {
          if (fs.existsSync(keyPath)) {
            try {
              connectConfig.privateKey = fs.readFileSync(keyPath)
              privateKeyFound = true
              this.ctx.log.info(`使用默认私钥文件: ${keyPath}`)
              break
            } catch (error) {
              this.ctx.log.warn(`无法读取私钥文件: ${keyPath}`)
              continue
            }
          }
        }

        if (!privateKeyFound) {
          reject(new Error('请提供密码或私钥文件路径，或确保~/.ssh/目录下有可用的私钥文件'))
          return
        }
      }

      client.on('ready', () => {
        this.ctx.log.info('SSH连接成功')
        resolve()
      })

      client.on('error', (err) => {
        this.ctx.log.error('SSH连接失败:', err)
        reject(err)
      })

      client.connect(connectConfig)
    })
  }

  private async uploadFile(client: Client, buffer: Buffer, remotePath: string): Promise<void> {
    return new Promise((resolve, reject) => {
      client.sftp((err, sftp) => {
        if (err) {
          reject(err)
          return
        }

        sftp.writeFile(remotePath, buffer, (err) => {
          if (err) {
            reject(err)
            return
          }
          resolve()
        })
      })
    })
  }
}

export default (ctx: IPicGo) => {
  const uploader = new ScpUploader(ctx)
  
  ctx.helper.uploader.register('scp', {
    name: 'SCP',
    handle: uploader.handle.bind(uploader),
    config: uploader.config.bind(uploader)
  })
} 
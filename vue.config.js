const { defineConfig } = require('@vue/cli-service')
const fs = require('fs')
const path = require('path')

module.exports = defineConfig({
  transpileDependencies: false,
  publicPath: './',
  productionSourceMap: false,
  lintOnSave: false,
  devServer: {
    // 不监听 public/ 的静态文件变化：配置文件写回后避免整页刷新冲掉面板状态。
    // 手动修改 region-config.json 后使用页面上的「重新加载配置」按钮即可。
    static: {
      watch: false
    },
    // 写回本地配置文件的接口：POST /api/region-config
    onBeforeSetupMiddleware(devServer) {
      const configPath = path.join(__dirname, 'public', 'data', 'region-config.json')
      devServer.app.post('/api/region-config', (req, res) => {
        let body = ''
        req.on('data', (chunk) => (body += chunk))
        req.on('end', () => {
          try {
            const parsed = JSON.parse(body)
            fs.mkdirSync(path.dirname(configPath), { recursive: true })
            fs.writeFileSync(configPath, JSON.stringify(parsed, null, 2))
            res.setHeader('Content-Type', 'application/json')
            res.end(JSON.stringify({ ok: true }))
          } catch (e) {
            res.statusCode = 400
            res.setHeader('Content-Type', 'application/json')
            res.end(JSON.stringify({ ok: false, error: e.message }))
          }
        })
      })
    }
  }
})

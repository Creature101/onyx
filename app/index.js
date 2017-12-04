const { app, BrowserWindow, Menu, ipcMain } = require('electron')
const { appReady, is } = require('electron-util')
const Store = require('electron-store')
const getPort = require('get-port')
const createOnyxServer = require('onyx-server').default
const path = require('path')
const StaticServer = require('static-server')
const url = require('url')

const { config } = require(path.join(__dirname, 'package.json'))
const SWARM_WS_URL =
  process.env.SWARM_WS_URL ||
  (config && config.swarmWsUrl) ||
  'ws://localhost:8546'
const SWARM_HTTP_URL =
  process.env.SWARM_HTTP_URL ||
  (config && config.swarmHttpUrl) ||
  'http://localhost:8500'

const menu = Menu.buildFromTemplate([
  {
    label: is.macos ? 'Onyx' : 'File',
    submenu: [
      {
        label: 'Reset',
        click: () => {
          store.delete('wsUrl')
          if (mainWindow != null) {
            clearEventListeners()
            mainWindow.close()
            mainWindow = null
          }
          start()
        },
      },
      {
        label: 'Quit',
        accelerator: 'CmdOrCtrl+Q',
        click: () => {
          app.quit()
        },
      },
    ],
  },
  {
    label: 'Edit',
    submenu: [
      { label: 'Undo', accelerator: 'CmdOrCtrl+Z', selector: 'undo:' },
      { label: 'Redo', accelerator: 'Shift+CmdOrCtrl+Z', selector: 'redo:' },
      { type: 'separator' },
      { label: 'Cut', accelerator: 'CmdOrCtrl+X', selector: 'cut:' },
      { label: 'Copy', accelerator: 'CmdOrCtrl+C', selector: 'copy:' },
      { label: 'Paste', accelerator: 'CmdOrCtrl+V', selector: 'paste:' },
      {
        label: 'Select All',
        accelerator: 'CmdOrCtrl+A',
        selector: 'selectAll:',
      },
    ],
  },
  {
    label: 'View',
    submenu: [
      {
        label: 'Reload',
        accelerator: 'CmdOrCtrl+R',
        click: (item, focusedWindow) => {
          if (focusedWindow) focusedWindow.reload()
        },
      },
      {
        label: 'Toggle Developer Tools',
        accelerator: is.macos ? 'Alt+Command+I' : 'Ctrl+Shift+I',
        click: (item, focusedWindow) => {
          if (focusedWindow) focusedWindow.toggleDevTools()
        },
      },
      { type: 'separator' },
      { role: 'togglefullscreen' },
      { role: 'resetzoom' },
      { role: 'zoomin' },
      { role: 'zoomout' },
    ],
  },
])

let appServer, loadingWindow, mainWindow, connectionError

const store = new Store({ name: is.development ? 'onyx-dev' : 'onyx' })

const createMainWindow = async url => {
  await appReady

  Menu.setApplicationMenu(menu)

  mainWindow = new BrowserWindow({ width: 800, height: 600, show: false })

  mainWindow.loadURL(url)
  
  showFunc = () => {
    mainWindow.show()
  }
  
  closedFunc = () => {
    mainWindow = null
  }

  mainWindow.on('ready-to-show', showFunc)
  mainWindow.on('closed', closedFunc)
}

const startAppServer = async () => {
  const appPort = await getPort()
  const appServer = new StaticServer({
    rootPath: path.join(__dirname, 'build'),
    port: appPort,
  })

  return new Promise(resolve => {
    appServer.start(() => {
      app.on('quit', () => {
        appServer.stop()
      })
      resolve(appServer)
    })
  })
}

const startLocalOnyxServer = async () => {
  const port = await getPort()
  await createOnyxServer({
    wsUrl: SWARM_WS_URL,
    httpUrl: SWARM_HTTP_URL,
    port,
    store,
  })
  return port
}

const start = async () => {
  let appPort
  if (is.development) {
    appPort = 3000
  } else {
    if (appServer == null) {
      appServer = await startAppServer()
    }
    appPort = appServer.port
  }
  let appUrl = `http://localhost:${appPort}`

  const storedWsUrl = store.get('wsUrl')
  if (storedWsUrl) {
    if (storedWsUrl === 'local') {
      // Setup a local Graphql server
      try {
        const serverPort = await startLocalOnyxServer(appPort)
        const wsUrl = `ws://localhost:${serverPort}/graphql`
        const httpUrl = `http://localhost:${serverPort}`
        appUrl = appUrl + `/?wsUrl=${wsUrl}&httpUrl=${httpUrl}`
      } catch (err) {
        console.warn('err: ', err)
        const errorMsg = 'There was an issue starting local GraphQL server, you may want to check you have a swarm node running on default port 8546, or that you specified the correct port if not using default'
        appUrl = appUrl + `/?wsUrl=${storedWsUrl}&connectionError=${errorMsg}`
        if (appServer != null) {
          appServer.stop()
        }
      }
    } else {
      // Use stored remote server url
      let domain
      if (storedWsUrl.indexOf('://') > -1) {
        domain = storedWsUrl.split('/')[2]
      } else if (storedWsUrl.indexOf('/') !== -1) {
        domain = storedWsUrl.split('/')[0]
      }
      if (!domain) {
        const errorMsg = 'Invalid ws url'
        appUrl = appUrl + `/?wsUrl=${storedWsUrl}&connectionError=${errorMsg}`
      } else {
        const httpUrl = `http://${domain}`
        appUrl = appUrl + `/?wsUrl=${storedWsUrl}&httpUrl=${httpUrl}`
      }
    }
  }

  if (mainWindow == null) {
    createMainWindow(appUrl)
  } else {
    mainWindow.loadURL(appUrl)
  }

  app.on('activate', () => {
    if (mainWindow == null) {
      createMainWindow(appUrl)
    }
  })
  
  app.on('certificate-error', (event, webContents, url, error, certificate, callback) => {
    console.warn('cert error: ', error)
  })
}

const clearEventListeners = () => {
  if (mainWindow) {
    mainWindow.removeListener('ready-to-show', showFunc)
    mainWindow.removeListener('closed', closedFunc)
  }
}

ipcMain.on('onSetWsUrl', (e, url) => {
  store.set('wsUrl', url)
  start()
})

start()
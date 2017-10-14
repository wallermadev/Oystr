const { app, BrowserWindow, ipcMain: ipc, Menu, shell, dialog } = require('electron');
const fs = require('fs');
const path = require('path');
const Windows = require('./windows');
const Settings = require('./settings');
const log = require('./utils/logger').create('menuItems');
const updateChecker = require('./updateChecker');
const ethereumNode = require('./ethereumNode.js');
const swarmNode = require('./swarmNode.js');
const ClientBinaryManager = require('./clientBinaryManager');


// Make easier to return values for specific systems
const switchForSystem = function (options) {
    if (process.platform in options) {
        return options[process.platform];
    } else if ('default' in options) {
        return options.default;
    }
    return null;
};


// create menu
// null -> null
const createMenu = function (webviews) {
    webviews = webviews || [];

    const menu = Menu.buildFromTemplate(menuTempl(webviews));
    Menu.setApplicationMenu(menu);
};


const restartNode = function (newType, newNetwork) {
    newNetwork = newNetwork || ethereumNode.network;

    log.info('Switch node', newType, newNetwork);

    return ethereumNode.restart(newType, newNetwork)
        .then(() => {
            Windows.getByType('main').load(global.interfaceAppUrl);

            createMenu(webviews);
        })
        .catch((err) => {
            log.error('Error switching node', err);
        });
};


// create a menu template
// null -> obj
let menuTempl = function (webviews) {
    const menu = [];
    webviews = webviews || [];

    // APP
    const fileMenu = [];

    if (process.platform === 'darwin') {
        fileMenu.push(
            {
                label: i18n.t('mist.applicationMenu.app.about', { app: Settings.appName }),
                click() {
                    Windows.createPopup('about', {
                        electronOptions: {
                            width: 420,
                            height: 230,
                            alwaysOnTop: true,
                        },
                    });
                },
            },
            {
                label: i18n.t('mist.applicationMenu.app.checkForUpdates'),
                click() {
                    updateChecker.runVisibly();
                },
            }, {
                label: i18n.t('mist.applicationMenu.app.checkForNodeUpdates'),
                click() {
                    // remove skipVersion
                    fs.writeFileSync(
                        path.join(Settings.userDataPath, 'skippedNodeVersion.json'),
                        '' // write no version
                    );

                    // true = will restart after updating and user consent
                    ClientBinaryManager.init(true);
                },
            }, {
                type: 'separator',
            },
            {
                label: i18n.t('mist.applicationMenu.app.services', { app: Settings.appName }),
                role: 'services',
                submenu: [],
            },
            {
                type: 'separator',
            },
            {
                label: i18n.t('mist.applicationMenu.app.hide', { app: Settings.appName }),
                accelerator: 'Command+H',
                role: 'hide',
            },
            {
                label: i18n.t('mist.applicationMenu.app.hideOthers', { app: Settings.appName }),
                accelerator: 'Command+Alt+H',
                role: 'hideothers',
            },
            {
                label: i18n.t('mist.applicationMenu.app.showAll', { app: Settings.appName }),
                role: 'unhide',
            },
            {
                type: 'separator',
            }
        );
    }
    fileMenu.push(
        {
            label: i18n.t('mist.applicationMenu.app.quit', { app: Settings.appName }),
            accelerator: 'CommandOrControl+Q',
            click() {
                app.quit();
            },
        });
    menu.push({
        label: i18n.t('mist.applicationMenu.app.label', { app: Settings.appName }),
        submenu: fileMenu,
    });

    // ACCOUNTS
    menu.push({
        label: i18n.t('mist.applicationMenu.file.label'),
        submenu: [
            {
                label: i18n.t('mist.applicationMenu.file.newAccount'),
                accelerator: 'CommandOrControl+N',
                click() {
                    Windows.createPopup('requestAccount', {
                        electronOptions: {
                            width: 420, height: 230, alwaysOnTop: true,
                        },
                    });
                },
            },
            {
                label: i18n.t('mist.applicationMenu.file.importPresale'),
                accelerator: 'CommandOrControl+I',
                enabled: ethereumNode.isMainNetwork,
                click() {
                    Windows.createPopup('importAccount', {
                        electronOptions: {
                            width: 600, height: 370, alwaysOnTop: true,
                        },
                    });
                },
            },
            {
                type: 'separator',
            },
            {
                label: i18n.t('mist.applicationMenu.file.backup'),
                submenu: [
                    {
                        label: i18n.t('mist.applicationMenu.file.backupKeyStore'),
                        click() {
                            let userPath = Settings.userHomePath;

                            // eth
                            if (ethereumNode.isEth) {
                                if (process.platform === 'win32') {
                                    userPath = `${Settings.appDataPath}\\Web3\\keys`;
                                } else {
                                    userPath += '/.web3/keys';
                                }

                                // geth
                            } else {
                                if (process.platform === 'darwin') {
                                    userPath += '/Library/Pirl/keystore';
                                }

                                if (process.platform === 'freebsd' ||
                                    process.platform === 'linux' ||
                                    process.platform === 'sunos') {
                                    userPath += '/.ethereum/keystore';
                                }

                                if (process.platform === 'win32') {
                                    userPath = `${Settings.appDataPath}\\Pirl\\keystore`;
                                }
                            }

                            shell.showItemInFolder(userPath);
                        },
                    }, {
                        label: i18n.t('mist.applicationMenu.file.backupMist'),
                        click() {
                            shell.openItem(Settings.userDataPath);
                        },
                    },
                ],
            },
            {
                type: 'separator',
            },
            {
                label: i18n.t('mist.applicationMenu.file.swarmUpload'),
                accelerator: 'Shift+CommandOrControl+U',
                click() {
                    const focusedWindow = BrowserWindow.getFocusedWindow();
                    const paths = dialog.showOpenDialog(focusedWindow, {
                        properties: ['openFile', 'openDirectory']
                    });
                    if (paths && paths.length === 1) {
                        const isDir = fs.lstatSync(paths[0]).isDirectory();
                        const defaultPath = path.join(paths[0], 'index.html');
                        const uploadConfig = {
                            path: paths[0],
                            kind: isDir ? 'directory' : 'file',
                            defaultFile: fs.existsSync(defaultPath) ? '/index.html' : null
                        };
                        swarmNode.upload(uploadConfig).then((hash) => {
                            focusedWindow.webContents.executeJavaScript(`
                              Tabs.update('browser', {$set: {
                                  url: 'bzz://${hash}',
                                  redirect: 'bzz://${hash}'
                              }});
                              LocalStore.set('selectedTab', 'browser');
                            `);
                            console.log('Hash uploaded:', hash);
                        }).catch(e => console.log(e));
                    }
                }
            }]
    });

    // EDIT
    menu.push({
        label: i18n.t('mist.applicationMenu.edit.label'),
        submenu: [
            {
                label: i18n.t('mist.applicationMenu.edit.undo'),
                accelerator: 'CommandOrControl+Z',
                role: 'undo',
            },
            {
                label: i18n.t('mist.applicationMenu.edit.redo'),
                accelerator: 'Shift+CommandOrControl+Z',
                role: 'redo',
            },
            {
                type: 'separator',
            },
            {
                label: i18n.t('mist.applicationMenu.edit.cut'),
                accelerator: 'CommandOrControl+X',
                role: 'cut',
            },
            {
                label: i18n.t('mist.applicationMenu.edit.copy'),
                accelerator: 'CommandOrControl+C',
                role: 'copy',
            },
            {
                label: i18n.t('mist.applicationMenu.edit.paste'),
                accelerator: 'CommandOrControl+V',
                role: 'paste',
            },
            {
                label: i18n.t('mist.applicationMenu.edit.selectAll'),
                accelerator: 'CommandOrControl+A',
                role: 'selectall',
            },
        ],
    });

    // LANGUAGE (VIEW)
    const switchLang = langCode => function (menuItem, browserWindow) {
        try {
            // update i18next instance in browserWindow (Mist meteor interface)
            browserWindow.webContents.executeJavaScript(
                `TAPi18n.setLanguage("${langCode}");`
            );

            // set Accept_Language header
            const session = browserWindow.webContents.session;
            session.setUserAgent(session.getUserAgent(), langCode);

            // set navigator.language (dev console only)
            // browserWindow.webContents.executeJavaScript(
            //     `Object.defineProperty(navigator, 'language, {
            //         get() { return ${langCode}; }
            //     });`
            // );

            // reload browserWindow to apply language change
            // browserWindow.webContents.reload();
        } catch (err) {
            log.error(err);
        } finally {
            Settings.language = langCode;
            ipc.emit('backendAction_setLanguage');
        }
    };

    const currentLanguage = Settings.language;
    const languageMenu = Object.keys(i18n.options.resources)
        .filter(langCode => langCode !== 'dev')
        .map((langCode) => {
            const menuItem = {
                label: i18n.t(`mist.applicationMenu.view.langCodes.${langCode}`),
                type: 'checkbox',
                checked: (langCode === currentLanguage),
                click: switchLang(langCode),
            };
            return menuItem;
        });

    languageMenu.unshift({
        label: i18n.t('mist.applicationMenu.view.default'),
        click: switchLang(i18n.getBestMatchedLangCode(app.getLocale())),
    }, {
            type: 'separator',
        });

    // VIEW
    menu.push({
        label: i18n.t('mist.applicationMenu.view.label'),
        submenu: [
            {
                label: i18n.t('mist.applicationMenu.view.fullscreen'),
                accelerator: switchForSystem({
                    darwin: 'Command+Control+F',
                    default: 'F11',
                }),
                click() {
                    const mainWindow = Windows.getByType('main');

                    mainWindow.window.setFullScreen(!mainWindow.window.isFullScreen());
                },
            },
            {
                label: i18n.t('mist.applicationMenu.view.languages'),
                submenu: languageMenu,
            },
        ],
    });


    // DEVELOP
    const devToolsMenu = [];

    // change for wallet
    if (Settings.uiMode === 'mist') {
        devtToolsSubMenu = [{
            label: i18n.t('mist.applicationMenu.develop.devToolsMistUI'),
            accelerator: 'Alt+CommandOrControl+I',
            click() {
                if (curWindow = BrowserWindow.getFocusedWindow()) {
                    curWindow.toggleDevTools();
                }
            },
        }, {
            type: 'separator',
        }];

        // add webviews
        webviews.forEach((webview) => {
            devtToolsSubMenu.push({
                label: i18n.t('mist.applicationMenu.develop.devToolsWebview', { webview: webview.name }),
                click() {
                    Windows.getByType('main').send('uiAction_toggleWebviewDevTool', webview._id);
                },
            });
        });

        // wallet
    } else {
        devtToolsSubMenu = [{
            label: i18n.t('mist.applicationMenu.develop.devToolsWalletUI'),
            accelerator: 'Alt+CommandOrControl+I',
            click() {
                if (curWindow = BrowserWindow.getFocusedWindow()) {
                    curWindow.toggleDevTools();
                }
            },
        }];
    }

    const externalNodeMsg = (ethereumNode.isOwnNode) ? '' : ` (${i18n.t('mist.applicationMenu.develop.externalNode')})`;
    devToolsMenu.push({
        label: i18n.t('mist.applicationMenu.develop.devTools'),
        submenu: devtToolsSubMenu,
    });

    if (Settings.uiMode === 'mist') {
        devToolsMenu.push({
            label: i18n.t('mist.applicationMenu.develop.openRemix'),
            enabled: true,
            click() {
                Windows.createPopup('remix', {
                    url: 'https://remix.ethereum.org',
                    electronOptions: {
                        width: 1024,
                        height: 720,
                        center: true,
                        frame: true,
                        resizable: true,
                        titleBarStyle: 'default',
                    }
                });
            },
        });
    }

    devToolsMenu.push({
        label: i18n.t('mist.applicationMenu.develop.runTests'),
        enabled: (Settings.uiMode === 'mist'),
        click() {
            Windows.getByType('main').send('uiAction_runTests', 'webview');
        },
    });

    devToolsMenu.push({
        label: i18n.t('mist.applicationMenu.develop.logFiles') + externalNodeMsg,
        enabled: ethereumNode.isOwnNode,
        click() {
            try {
                shell.showItemInFolder(`${Settings.userDataPath}/node.log`);
            } catch (e) {
                log.info(e);
                log = 'Couldn\'t load log file.';
            }
        },
    });

    // add node switching menu
    devToolsMenu.push({
        type: 'separator',
    });


    // add node switch
    if (process.platform === 'darwin' || process.platform === 'win32') {
        const nodeSubmenu = [];

        const ethClient = ClientBinaryManager.getClient('eth');
        const gethClient = ClientBinaryManager.getClient('geth');

        if (gethClient) {
            nodeSubmenu.push(
                {
                    label: `Geth ${gethClient.version} (Go)`,
                    checked: ethereumNode.isOwnNode && ethereumNode.isGeth,
                    enabled: ethereumNode.isOwnNode,
                    type: 'checkbox',
                    click() {
                        restartNode('geth');
                    },
                }
            );
        }

        if (ethClient) {
            nodeSubmenu.push(
                {
                    label: `Eth ${ethClient.version} (C++)`,
                    checked: ethereumNode.isOwnNode && ethereumNode.isEth,
                    enabled: ethereumNode.isOwnNode,
                    // enabled: false,
                    type: 'checkbox',
                    click() {
                        restartNode('eth');
                    },
                }
            );
        }

        devToolsMenu.push({
            label: i18n.t('mist.applicationMenu.develop.ethereumNode'),
            submenu: nodeSubmenu,
        });
    }

    // add network switch
    devToolsMenu.push({
        label: i18n.t('mist.applicationMenu.develop.network'),
        submenu: [
            {
                label: i18n.t('mist.applicationMenu.develop.mainNetwork'),
                accelerator: 'CommandOrControl+Shift+1',
                checked: ethereumNode.isOwnNode && ethereumNode.isMainNetwork,
                enabled: ethereumNode.isOwnNode && !ethereumNode.isMainNetwork,
                type: 'checkbox',
                click() {
                    restartNode(ethereumNode.type, 'main');
                },
            }
        ]
    });

    // WINDOW
    menu.push({
        label: i18n.t('mist.applicationMenu.window.label'),
        role: 'window',
        submenu: [
            {
                label: i18n.t('mist.applicationMenu.window.minimize'),
                accelerator: 'CommandOrControl+M',
                role: 'minimize',
            },
            {
                label: i18n.t('mist.applicationMenu.window.close'),
                accelerator: 'CommandOrControl+W',
                role: 'close',
            },
            {
                type: 'separator',
            },
            {
                label: i18n.t('mist.applicationMenu.window.toFront'),
                role: 'front',
            },
        ],
    });

    // HELP
    const helpMenu = [];

    if (process.platform === 'freebsd' || process.platform === 'linux' ||
        process.platform === 'sunos' || process.platform === 'win32') {
        helpMenu.push(
            {
                label: i18n.t('mist.applicationMenu.app.about', { app: Settings.appName }),
                click() {
                    Windows.createPopup('about', {
                        electronOptions: {
                            width: 420,
                            height: 230,
                            alwaysOnTop: true,
                        },
                    });
                },
            },
            {
                label: i18n.t('mist.applicationMenu.app.checkForUpdates'),
                click() {
                    updateChecker.runVisibly();
                },
            }
        );
    }
    helpMenu.push({
        label: i18n.t('mist.applicationMenu.help.mistWiki'),
        click() {
            shell.openExternal('https://github.com/pirl/oystr/wiki');
        },
    }, {
            label: i18n.t('mist.applicationMenu.help.gitter'),
            click() {
                shell.openExternal('https://gitter.im/pirl/oystr');
            },
        }, {
            label: i18n.t('mist.applicationMenu.help.reportBug'),
            click() {
                shell.openExternal('https://github.com/pirl/oystr/issues');
            },
        });

    menu.push({
        label: i18n.t('mist.applicationMenu.help.label'),
        role: 'help',
        submenu: helpMenu,
    });
    return menu;
};


module.exports = createMenu;

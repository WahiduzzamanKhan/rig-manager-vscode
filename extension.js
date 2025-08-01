// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
const vscode = require('vscode');
// The 'child_process' module allows us to execute shell commands
const { exec, spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

// Declare a global variable for the StatusBarItem
let rStatusBarItem;

/**
 * Utility function to execute rig commands and parse JSON output
 * @param {string} command - The rig command to execute
 * @param {string} errorMessage - Custom error message for failures
 * @returns {Promise<any>} - Parsed JSON result
 */
function executeRigCommand(command, errorMessage = 'Error executing rig command') {
    return new Promise((resolve, reject) => {
        exec(command, (error, stdout, stderr) => {
            if (error) {
                vscode.window.showErrorMessage(`${errorMessage}: ${stderr}`);
                reject(new Error(stderr));
                return;
            }

            try {
                // Clean up the output to handle Windows path escaping issues
                let cleanOutput = stdout.trim();
                
                // On Windows, rig outputs paths with single backslashes which are invalid in JSON
                // We need to properly escape them
                if (process.platform === 'win32') {
                    // Use a more targeted approach: only escape backslashes in path-like strings
                    // Look for patterns like "C:\..." and escape the backslashes
                    cleanOutput = cleanOutput.replace(/"([A-Za-z]:[^"]*?)"/g, (match, path) => {
                        // Escape backslashes in the path
                        const escapedPath = path.replace(/\\/g, '\\\\');
                        return `"${escapedPath}"`;
                    });
                }
                
                const result = JSON.parse(cleanOutput);
                resolve(result);
            } catch (e) {
                console.error('Raw rig output:', stdout);
                console.error('JSON parse error:', e.message);
                vscode.window.showErrorMessage(`Failed to parse rig output: ${e.message}. Check the extension output for details.`);
                reject(e);
            }
        });
    });
}

/**
 * Creates quick pick items for version selection
 * @param {Array} versions - Array of version objects
 * @param {string} type - Type of selection ('switch', 'install', 'remove')
 * @returns {Array} - Array of quick pick items
 */
function createVersionQuickPickItems(versions, type) {
    switch (type) {
        case 'install':
            return versions.map(r => ({
                label: r.name,
                description: `(${r.type})`,
                detail: `Released on: ${new Date(r.date).toLocaleDateString()}`
            }));
        case 'remove':
            return versions.map(r => ({
                label: r.name,
                description: `(${r.version})`,
                detail: `Path: ${r.path}`
            }));
        case 'switch':
        default:
            return versions.map(r => ({
                label: r.name,
                description: r.default ? '(default)' : '',
                detail: `Version: ${r.version}, Path: ${r.path}`
            }));
    }
}

/**
 * Shows a version selection quick pick
 * @param {Array} versions - Array of version objects
 * @param {string} placeholder - Placeholder text for the quick pick
 * @param {string} type - Type of selection ('switch', 'install', 'remove')
 * @returns {Promise<any>} - Selected item or undefined
 */
async function showVersionQuickPick(versions, placeholder, type) {
    if (!versions || versions.length === 0) {
        const messages = {
            'switch': 'No R versions found. Please install one using "rig add".',
            'install': 'No available R versions found to install.',
            'remove': 'No R versions found to uninstall.'
        };
        vscode.window.showInformationMessage(messages[type] || messages['switch']);
        return undefined;
    }

    const quickPickItems = createVersionQuickPickItems(versions, type);
    return await vscode.window.showQuickPick(quickPickItems, {
        placeHolder: placeholder,
        matchOnDetail: true
    });
}

/**
 * Switches to a specific R version
 * @param {string} versionName - Name of the version to switch to
 * @returns {Promise<void>}
 */
async function switchToVersion(versionName) {
    const platform = process.platform;
    if (platform === 'win32') {
        // Windows: no sudo needed
        return new Promise((resolve, reject) => {
            exec(`rig default ${versionName}`, (error, stdout, stderr) => {
                if (error) {
                    vscode.window.showErrorMessage(`Failed to switch to ${versionName}: ${stderr}`);
                    reject(new Error(stderr));
                    return;
                }
                vscode.window.showInformationMessage(`Switched default R version to: ${versionName}`);
                updateStatusBar();
                launchRConsole(true);
                resolve();
            });
        });
    } else if (platform === 'darwin') {
        // macOS: try without sudo first, fallback to sudo if needed
        return new Promise((resolve, reject) => {
            exec(`rig default ${versionName}`, async (error, stdout, stderr) => {
                if (!error) {
                    vscode.window.showInformationMessage(`Switched default R version to: ${versionName}`);
                    updateStatusBar();
                    launchRConsole(true);
                    resolve();
                    return;
                }
                // If error, try with sudo
                const password = await vscode.window.showInputBox({
                    prompt: `Sudo password required to switch default R version to ${versionName}`,
                    password: true,
                    ignoreFocusOut: true
                });
                if (password === undefined) {
                    vscode.window.showWarningMessage(`Switch to R ${versionName} cancelled.`);
                    reject(new Error('Operation cancelled'));
                    return;
                }
                const child = spawn('sudo', ['-S', 'rig', 'default', versionName]);
                let stderrData = '';
                child.stdin.write(password + '\n');
                child.stdin.end();
                child.stdout.on('data', () => {});
                child.stderr.on('data', data => { stderrData += data.toString(); });
                child.on('close', code => {
                    if (code === 0) {
                        vscode.window.showInformationMessage(`Switched default R version to: ${versionName}`);
                        updateStatusBar();
                        launchRConsole(true);
                        resolve();
                    } else {
                        vscode.window.showErrorMessage(`Failed to switch to ${versionName}: ${stderrData}`);
                        reject(new Error(stderrData));
                    }
                });
                child.on('error', err => {
                    vscode.window.showErrorMessage(`Failed to start sudo process: ${err.message}`);
                    reject(err);
                });
            });
        });
    } else {
        // Linux: always prompt for sudo
        const password = await vscode.window.showInputBox({
            prompt: `Sudo password required to switch default R version to ${versionName}`,
            password: true,
            ignoreFocusOut: true
        });
        if (password === undefined) {
            vscode.window.showWarningMessage(`Switch to R ${versionName} cancelled.`);
            throw new Error('Operation cancelled');
        }
        return new Promise((resolve, reject) => {
            const child = spawn('sudo', ['-S', 'rig', 'default', versionName]);
            let stderrData = '';
            child.stdin.write(password + '\n');
            child.stdin.end();
            child.stdout.on('data', () => {});
            child.stderr.on('data', data => { stderrData += data.toString(); });
            child.on('close', code => {
                if (code === 0) {
                    vscode.window.showInformationMessage(`Switched default R version to: ${versionName}`);
                    updateStatusBar();
                    launchRConsole(true);
                    resolve();
                } else {
                    vscode.window.showErrorMessage(`Failed to switch to ${versionName}: ${stderrData}`);
                    reject(new Error(stderrData));
                }
            });
            child.on('error', err => {
                vscode.window.showErrorMessage(`Failed to start sudo process: ${err.message}`);
                reject(err);
            });
        });
    }
}

/**
 * Generic progress handler for install/uninstall operations (cross-platform)
 * @param {string} operation - Operation name ('install' or 'uninstall')
 * @param {string} version - Version to operate on
 * @param {string} rigCommand - The rig command to execute ('add' or 'rm')
 * @returns {Promise<void>}
 */
async function handleRigOperation(operation, version, rigCommand) {
    const platform = process.platform;
    
    // On Windows, rig operations typically don't require elevation
    if (platform === 'win32') {
        return handleWindowsRigOperation(operation, version, rigCommand);
    } else {
        // macOS and Linux require sudo
        return handleUnixRigOperation(operation, version, rigCommand);
    }
}

/**
 * Handles rig operations on Windows
 * @param {string} operation - Operation name ('install' or 'uninstall')
 * @param {string} version - Version to operate on
 * @param {string} rigCommand - The rig command to execute ('add' or 'rm')
 * @returns {Promise<void>}
 */
async function handleWindowsRigOperation(operation, version, rigCommand) {
    return vscode.window.withProgress({
        location: vscode.ProgressLocation.Notification,
        title: `${operation.charAt(0).toUpperCase() + operation.slice(1)}ing R version: ${version}`,
        cancellable: true
    }, (progress, token) => {
        const child = spawn('rig', [rigCommand, version], {
            shell: true,
            stdio: ['pipe', 'pipe', 'pipe']
        });

        return new Promise((resolve, reject) => {
            token.onCancellationRequested(() => {
                child.kill();
                vscode.window.showWarningMessage(`${operation.charAt(0).toUpperCase() + operation.slice(1)} of R ${version} cancelled.`);
                reject(new Error('Operation cancelled'));
            });

            let stderr = '';

            child.stdout.on('data', data => {
                const output = data.toString();
                const message = output.trim().split('\n').pop();
                if (message) {
                    progress.report({ message });
                }
            });

            child.stderr.on('data', data => {
                const output = data.toString();
                stderr += output;
                console.error(`stderr: ${output}`);
            });

            child.on('close', code => {
                if (code === 0) {
                    vscode.window.showInformationMessage(`Successfully ${operation}ed R version: ${version}`);
                    updateStatusBar();
                    resolve();
                } else {
                    const errorMsg = stderr.includes('Access is denied') || stderr.includes('permission')
                        ? `Failed to ${operation} R ${version}. Administrator privileges may be required. Try running VS Code as administrator.`
                        : `Failed to ${operation} R version ${version}. ${stderr || `Exit code: ${code}`}`;
                    vscode.window.showErrorMessage(errorMsg);
                    reject(new Error(errorMsg));
                }
            });

            child.on('error', err => {
                vscode.window.showErrorMessage(`Failed to start ${operation} process: ${err.message}`);
                reject(err);
            });
        });
    });
}

/**
 * Handles rig operations on Unix-like systems (macOS, Linux) with sudo
 * @param {string} operation - Operation name ('install' or 'uninstall')
 * @param {string} version - Version to operate on
 * @param {string} rigCommand - The rig command to execute ('add' or 'rm')
 * @returns {Promise<void>}
 */
async function handleUnixRigOperation(operation, version, rigCommand) {
    const password = await vscode.window.showInputBox({
        prompt: `Sudo password required to ${operation} R ${version}`,
        password: true,
        ignoreFocusOut: true
    });

    if (password === undefined) {
        vscode.window.showWarningMessage(`${operation.charAt(0).toUpperCase() + operation.slice(1)} of R ${version} cancelled.`);
        return;
    }

    return vscode.window.withProgress({
        location: vscode.ProgressLocation.Notification,
        title: `${operation.charAt(0).toUpperCase() + operation.slice(1)}ing R version: ${version}`,
        cancellable: true
    }, (progress, token) => {
        const child = spawn('sudo', ['-S', 'rig', rigCommand, version]);

        return new Promise((resolve, reject) => {
            token.onCancellationRequested(() => {
                child.kill();
                vscode.window.showWarningMessage(`${operation.charAt(0).toUpperCase() + operation.slice(1)} of R ${version} cancelled.`);
                reject(new Error('Operation cancelled'));
            });

            child.stdin.write(password + '\n');
            child.stdin.end();

            child.stdout.on('data', data => {
                const message = data.toString().trim().split('\n').pop();
                progress.report({ message });
            });

            child.stderr.on('data', data => {
                console.error(`stderr: ${data}`);
            });

            child.on('close', code => {
                if (code === 0) {
                    vscode.window.showInformationMessage(`Successfully ${operation}ed R version: ${version}`);
                    updateStatusBar();
                    resolve();
                } else {
                    const errorMsg = code === 1 
                        ? `Failed to ${operation} R ${version}. Incorrect password or permission error.`
                        : `Failed to ${operation} R version ${version}. See extension host logs for details. Exit code: ${code}`;
                    vscode.window.showErrorMessage(errorMsg);
                    reject(new Error(errorMsg));
                }
            });

            child.on('error', err => {
                vscode.window.showErrorMessage(`Failed to start ${operation} process: ${err.message}`);
                reject(err);
            });
        });
    });
}

/**
 * This method is called when your extension is activated.
 * @param {vscode.ExtensionContext} context
 */
function activate(context) {
    console.log('"rig-manager" is now active!');

    // Create the status bar item
    rStatusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
    rStatusBarItem.command = 'rig-manager.switchVersion';
    context.subscriptions.push(rStatusBarItem);

    // Register all commands
    registerCommands(context);

    // Update status bar and launch console on activation
    updateStatusBar();
    launchRConsole();
    
    // Check for renv requirements when extension activates
    setTimeout(() => {
        checkRenvRequirements().catch(error => {
            console.error('Error checking renv requirements:', error);
        });
    }, 1000);
}

/**
 * Registers all extension commands
 * @param {vscode.ExtensionContext} context
 */
function registerCommands(context) {
    // Switch R version command
    const switchVersionDisposable = vscode.commands.registerCommand('rig-manager.switchVersion', async () => {
        try {
            const versionsData = await executeRigCommand('rig list --json', 'Error fetching installed R versions');
            const selectedItem = await showVersionQuickPick(versionsData, 'Select an R version to switch to', 'switch');
            
            if (selectedItem) {
                await switchToVersion(selectedItem.label);
            }
        } catch {
            // Error already handled in utility functions
        }
    });

    // Install R version command
    const installVersionDisposable = vscode.commands.registerCommand('rig-manager.installVersion', () => {
        vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: "Fetching available R versions...",
            cancellable: false
        }, async () => {
            try {
                const availableVersions = await executeRigCommand('rig available --json', 'Could not fetch available R versions');
                const selectedItem = await showVersionQuickPick(availableVersions, 'Select an R version to install', 'install');
                
                if (selectedItem) {
                    await handleRigOperation('install', selectedItem.label, 'add');
                }
            } catch {
                // Error already handled in utility functions
            }
        });
    });

    // Remove R version command
    const removeVersionDisposable = vscode.commands.registerCommand('rig-manager.removeVersion', async () => {
        try {
            const installedVersions = await executeRigCommand('rig list --json', 'Could not fetch installed R versions');
            const removableVersions = installedVersions.filter(r => !r.default);
            
            if (removableVersions.length === 0) {
                vscode.window.showWarningMessage('Cannot uninstall the default R version. Please set a different version as default first.');
                return;
            }

            const selectedItem = await showVersionQuickPick(removableVersions, 'Select an R version to uninstall', 'remove');
            
            if (selectedItem) {
                const choice = await vscode.window.showWarningMessage(
                    `Are you sure you want to uninstall R version ${selectedItem.label}? This action cannot be undone.`,
                    'Yes, Uninstall',
                    'Cancel'
                );
                
                if (choice === 'Yes, Uninstall') {
                    await handleRigOperation('uninstall', selectedItem.label, 'rm');
                }
            }
        } catch {
            // Error already handled in utility functions
        }
    });

    // Refresh command
    const refreshDisposable = vscode.commands.registerCommand('rig-manager.refresh', () => {
        updateStatusBar();
        launchRConsole(true);
        vscode.window.showInformationMessage('R version status refreshed and console restarted.');
    });

    // Check renv requirements command
    const checkRenvDisposable = vscode.commands.registerCommand('rig-manager.checkRenvRequirements', () => {
        checkRenvRequirements(true);
    });

    // Add all disposables to context
    context.subscriptions.push(
        switchVersionDisposable,
        installVersionDisposable,
        removeVersionDisposable,
        refreshDisposable,
        checkRenvDisposable
    );
}

/**
 * Launches an R console in the terminal.
 * @param {boolean} forceNew - If true, disposes of existing R terminals and creates a new one.
 */
function launchRConsole(forceNew = false) {
    const config = vscode.workspace.getConfiguration('rig-manager');
    if (!config.get('rConsole.autoLaunch')) {
        return;
    }

    // Dispose of existing R terminals if forcing new
    if (forceNew) {
        const rTerminalNames = ['R Console', 'R Interactive'];
        const existingRTerminals = vscode.window.terminals.filter(t => 
            rTerminalNames.includes(t.name)
        );
        
        if (existingRTerminals.length > 0) {
            console.log(`Disposing ${existingRTerminals.length} existing R terminal(s)`);
            existingRTerminals.forEach(terminal => {
                console.log(`Disposing terminal: ${terminal.name}`);
                terminal.dispose();
            });
        }
    }

    // Check if REditorSupport.r extension is installed
    const rEditorSupport = vscode.extensions.getExtension('REditorSupport.r');

    if (rEditorSupport) {
        console.log('REditorSupport.r found. Creating R terminal.');
        vscode.commands.executeCommand('r.createRTerm');
    } else {
        console.log('REditorSupport.r not found. Launching a basic R console.');
        launchBasicRConsole(forceNew);
    }
}

/**
 * Launches a basic R console when REditorSupport is not available
 * @param {boolean} forceNew - Whether to force creation of new terminal
 */
function launchBasicRConsole(forceNew) {
    const R_CONSOLE_NAME = 'R Console';
    const existingTerminal = vscode.window.terminals.find(t => t.name === R_CONSOLE_NAME);

    if (existingTerminal && !forceNew) {
        return;
    }

    if (existingTerminal && forceNew) {
        existingTerminal.dispose();
    }

    executeRigCommand('rig list --json', 'Could not launch R console')
        .then(versionsData => {
            const defaultVersion = versionsData.find(r => r.default === true);

            if (defaultVersion && defaultVersion.binary) {
                const rTerminal = vscode.window.createTerminal({
                    name: R_CONSOLE_NAME,
                    shellPath: defaultVersion.binary,
                });
                rTerminal.show();
            } else {
                vscode.window.showWarningMessage('No default R version found. Cannot launch R console.');
            }
        })
        .catch(() => {
            // Error already handled in executeRigCommand
        });
}

/**
 * Updates the status bar item with the current default R version.
 */
function updateStatusBar() {
    const config = vscode.workspace.getConfiguration('rig-manager');
    if (!config.get('statusBar.visible')) {
        rStatusBarItem.hide();
        return;
    }

    executeRigCommand('rig list --json', 'Error fetching R versions for status bar')
        .then(versionsData => {
            const defaultVersion = versionsData.find(r => r.default === true);

            if (defaultVersion) {
                rStatusBarItem.text = `$(versions) R: ${defaultVersion.version}`;
                rStatusBarItem.tooltip = `Default R Version: ${defaultVersion.name} (${defaultVersion.version})`;
                rStatusBarItem.show();
            } else {
                rStatusBarItem.text = `$(versions) R: Not set`;
                rStatusBarItem.tooltip = 'No default R version selected. Click to choose one.';
                rStatusBarItem.show();
            }
        })
        .catch(() => {
            rStatusBarItem.hide();
        });
}

/**
 * Checks if the current workspace has an renv.lock file and suggests switching to the required R version.
 * @param {boolean} forceCheck - If true, bypasses the configuration setting and always checks
 */
async function checkRenvRequirements(forceCheck = false) {
    if (!forceCheck) {
        const config = vscode.workspace.getConfiguration('rig-manager');
        if (!config.get('renv.autoCheck')) {
            return;
        }
    }

    if (!vscode.workspace.workspaceFolders || vscode.workspace.workspaceFolders.length === 0) {
        return;
    }

    const workspaceRoot = vscode.workspace.workspaceFolders[0].uri.fsPath;
    const renvLockPath = path.join(workspaceRoot, 'renv.lock');

    try {
        if (!fs.existsSync(renvLockPath)) {
            if (forceCheck) {
                vscode.window.showInformationMessage('No renv.lock file found in the current workspace.');
            }
            return;
        }

        const renvLockContent = fs.readFileSync(renvLockPath, 'utf8');
        
        let renvData;
        try {
            renvData = JSON.parse(renvLockContent);
        } catch (parseError) {
            console.error('Failed to parse renv.lock file:', parseError.message);
            console.error('renv.lock content preview:', renvLockContent.substring(0, 200));
            if (forceCheck) {
                vscode.window.showErrorMessage('Found renv.lock file but failed to parse it. Please check if it\'s valid JSON.');
            }
            return;
        }
        
        const requiredRVersion = renvData.R?.Version;
        
        if (!requiredRVersion) {
            console.log('No R version specified in renv.lock');
            if (forceCheck) {
                vscode.window.showInformationMessage('No R version requirement found in renv.lock file.');
            }
            return;
        }

        console.log(`Found renv.lock requiring R version: ${requiredRVersion}`);

        const installedVersions = await executeRigCommand('rig list --json', 'Error checking installed R versions');
        const currentDefault = installedVersions.find(r => r.default === true);
        
        if (currentDefault && currentDefault.version === requiredRVersion) {
            console.log(`Already using required R version: ${requiredRVersion}`);
            if (forceCheck) {
                vscode.window.showInformationMessage(`Already using the required R version: ${requiredRVersion}`);
            }
            return;
        }

        await handleRenvVersionRequirement(requiredRVersion, installedVersions, currentDefault);

    } catch (error) {
        if (error.code === 'ENOENT') {
            return;
        } else {
            console.error('Error in checkRenvRequirements:', error.message);
            if (forceCheck) {
                vscode.window.showErrorMessage(`Error checking renv requirements: ${error.message}`);
            }
        }
    }
}

/**
 * Handles the renv version requirement logic
 * @param {string} requiredRVersion - Required R version from renv.lock
 * @param {Array} installedVersions - Array of installed R versions
 * @param {Object} currentDefault - Current default R version
 */
async function handleRenvVersionRequirement(requiredRVersion, installedVersions, currentDefault) {
    let requiredVersionInstalled = installedVersions.find(r => r.version === requiredRVersion);
    
    if (!requiredVersionInstalled) {
        const [major, minor] = requiredRVersion.split('.');
        requiredVersionInstalled = installedVersions.find(r => {
            const [installedMajor, installedMinor] = r.version.split('.');
            return installedMajor === major && installedMinor === minor;
        });
    }

    if (requiredVersionInstalled) {
        const versionMessage = requiredVersionInstalled.version === requiredRVersion 
            ? `This project requires R version ${requiredRVersion} (found in renv.lock). Currently using ${currentDefault?.version || 'unknown'}. Would you like to switch?`
            : `This project requires R version ${requiredRVersion} (found in renv.lock). Found compatible version ${requiredVersionInstalled.version}. Currently using ${currentDefault?.version || 'unknown'}. Would you like to switch?`;
        
        const choice = await vscode.window.showInformationMessage(
            versionMessage,
            'Switch to Required Version',
            'Not Now'
        );
        
        if (choice === 'Switch to Required Version') {
            await switchToVersion(requiredVersionInstalled.name);
        }
    } else {
        const choice = await vscode.window.showWarningMessage(
            `This project requires R version ${requiredRVersion} (found in renv.lock), but it's not installed. Currently using ${currentDefault?.version || 'unknown'}.`,
            'Install Required Version',
            'Not Now'
        );
        
        if (choice === 'Install Required Version') {
            await handleRigOperation('install', requiredRVersion, 'add');
        }
    }
}

/**
 * This method is called when your extension is deactivated
 */
function deactivate() {}

module.exports = {
    activate,
    deactivate
}

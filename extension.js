// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
const vscode = require('vscode');
// The 'child_process' module allows us to execute shell commands
const { exec, spawn } = require('child_process');

// Declare a global variable for the StatusBarItem
let rStatusBarItem;

/**
 * This method is called when your extension is activated.
 * @param {vscode.ExtensionContext} context
 */
function activate(context) {

    console.log('"rig-manager" is now active!');

    // Create the status bar item.
    // We align it to the left and give it a priority to place it to the left of the language indicator.
    rStatusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
    rStatusBarItem.command = 'rig-manager.switchVersion';
    context.subscriptions.push(rStatusBarItem);

    // The command to switch R versions
    let switchVersionDisposable = vscode.commands.registerCommand('rig-manager.switchVersion', function () {
		// Execute the 'rig list --json' command to get all installed R versions in JSON format
        exec('rig list --json', (error, stdout, stderr) => {
            if (error) {
                vscode.window.showErrorMessage(`Error executing rig: ${stderr}`);
                return;
            }

            try {
				// Parse the JSON output from rig
                const versionsData = JSON.parse(stdout);
				
                if (!versionsData || versionsData.length === 0) {
                    vscode.window.showInformationMessage('No R versions found. Please install one using "rig add".');
                    return;
                }
                
                // Create a list of items for the quick pick dropdown
				const quickPickItems = versionsData.map(r => ({
                    label: r.name,
                    description: r.default ? '(default)' : '',
                    detail: `Version: ${r.version}, Path: ${r.path}`
                }));

				// Show a quick pick dropdown with the list of R versions
                vscode.window.showQuickPick(quickPickItems, {
                    placeHolder: 'Select an R version to switch to',
                    matchOnDetail: true
                }).then(selectedItem => {
                    if (selectedItem) {
						// If the user selected a version, use its name to set the default
                        const selectedVersionName = selectedItem.label;
                        exec(`rig default ${selectedVersionName}`, (error, stdout, stderr) => {
                            if (error) {
                                vscode.window.showErrorMessage(`Failed to switch to ${selectedVersionName}: ${stderr}`);
                                return;
                            }
                            vscode.window.showInformationMessage(`Switched default R version to: ${selectedVersionName}`);
                            // After switching, update the status bar
                            updateStatusBar();
                            launchRConsole(true); // force a new console with the new version
                        });
                    }
                });
            } catch (e) {
                vscode.window.showErrorMessage(`Failed to parse rig output: ${e.message}`);
            }
        });
    });
    context.subscriptions.push(switchVersionDisposable);

    // The command to install R versoin
    let installVersionDisposable = vscode.commands.registerCommand('rig-manager.installVersion', () => {
        vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: "Fetching available R versions...",
            cancellable: false
        }, async () => {
            // Get available versions from rig in json format
            exec('rig available --json', (error, stdout, stderr) => {
                if (error) {
                    vscode.window.showErrorMessage(`Could not fetch available R versions: ${stderr}`);
                    return;
                }

                try {
                    // Parse the JSON output from rig
                    const availableVersions = JSON.parse(stdout);
                    if (!availableVersions || availableVersions.length === 0) {
                        vscode.window.showInformationMessage('No available R versions found to install.');
                        return;
                    }

                    // Create a list of items for the quick pick dropdown
                    const quickPickItems = availableVersions.map(r => ({
                        label: r.name,
                        description: `(${r.type})`,
                        detail: `Released on: ${new Date(r.date).toLocaleDateString()}`
                    }));

                    // Show Quick Pick to the user
                    vscode.window.showQuickPick(quickPickItems, {
                        placeHolder: 'Select an R version to install',
                        matchOnDetail: true
                    }).then(selectedItem => {
                        if (selectedItem) {
                            // Install the selected version (using its label) with progress
                            installWithProgress(selectedItem.label);
                        }
                    });
                } catch (e) {
                    vscode.window.showErrorMessage(`Failed to parse rig output: ${e.message}`);
                }
            });
        });
    });
    context.subscriptions.push(installVersionDisposable);

    // The command to remove/uninstall R version
    let removeVersionDisposable = vscode.commands.registerCommand('rig-manager.removeVersion', () => {
        // Get installed versions from rig in json format
        exec('rig list --json', (error, stdout, stderr) => {
            if (error) {
                vscode.window.showErrorMessage(`Could not fetch installed R versions: ${stderr}`);
                return;
            }

            try {
                // Parse the JSON output from rig
                const installedVersions = JSON.parse(stdout);
                if (!installedVersions || installedVersions.length === 0) {
                    vscode.window.showInformationMessage('No R versions found to uninstall.');
                    return;
                }

                // Filter out the default version to prevent accidental removal
                const removableVersions = installedVersions.filter(r => !r.default);
                
                if (removableVersions.length === 0) {
                    vscode.window.showWarningMessage('Cannot uninstall the default R version. Please set a different version as default first.');
                    return;
                }

                // Create a list of items for the quick pick dropdown
                const quickPickItems = removableVersions.map(r => ({
                    label: r.name,
                    description: `(${r.version})`,
                    detail: `Path: ${r.path}`
                }));

                // Show Quick Pick to the user
                vscode.window.showQuickPick(quickPickItems, {
                    placeHolder: 'Select an R version to uninstall',
                    matchOnDetail: true
                }).then(selectedItem => {
                    if (selectedItem) {
                        // Confirm before uninstalling
                        vscode.window.showWarningMessage(
                            `Are you sure you want to uninstall R version ${selectedItem.label}? This action cannot be undone.`,
                            'Yes, Uninstall',
                            'Cancel'
                        ).then(choice => {
                            if (choice === 'Yes, Uninstall') {
                                uninstallWithProgress(selectedItem.label);
                            }
                        });
                    }
                });
            } catch (e) {
                vscode.window.showErrorMessage(`Failed to parse rig output: ${e.message}`);
            }
        });
    });
    context.subscriptions.push(removeVersionDisposable);

    // Add a command to refresh the status bar
    let refreshDisposable = vscode.commands.registerCommand('rig-manager.refresh', () => {
        updateStatusBar();
        launchRConsole(true); // Also restart the console on refresh
        vscode.window.showInformationMessage('R version status refreshed and console restarted.');
    });
    context.subscriptions.push(refreshDisposable);

    // Update status bar and launch console on activation
    updateStatusBar();
    launchRConsole();
}

/**
 * Installs an R version using spawn to handle long-running processes that may require sudo.
 * It prompts the user for their password and pipes it to the sudo command.
 * @param {string} version - The version of R to install (e.g., "4.3.1", "devel").
 */
async function installWithProgress(version) {
    // Prompt the user for their password to use with sudo
    const password = await vscode.window.showInputBox({
        prompt: `Sudo password required to install R ${version}`,            password: true,
        ignoreFocusOut: true // Keep prompt open even if it loses focus
    });

    // If the user cancels the password prompt, do nothing.
    if (password === undefined) {
        vscode.window.showWarningMessage(`Installation of R ${version} cancelled.`);
        return;
    }

    vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: `Installing R version: ${version}`,
            cancellable: true
    }, (progress, token) => {
        // The command is `sudo`, with `-S` to read the password from stdin.
        // The arguments are the rest of the command.
        const child = spawn('sudo', ['-S', 'rig', 'add', version]);

        return new Promise((resolve, reject) => {
            token.onCancellationRequested(() => {
                // Sending SIGTERM to the sudo process. This might not kill child processes
                // spawned by rig, but it's the safest approach without more complex logic.
                child.kill();
                vscode.window.showWarningMessage(`Installation of R ${version} cancelled.`);
                reject();
            });

            // Write the password to the stdin of the sudo command, followed by a newline.
            child.stdin.write(password + '\n');
            child.stdin.end();

            child.stdout.on('data', data => {
                // Report progress from the command's output
                const message = data.toString().trim().split('\n').pop();
                progress.report({ message });
            });

            child.stderr.on('data', data => {
                // Log stderr for debugging, but don't show it all to the user.
                // Specific errors are handled in the 'close' event.
                console.error(`stderr: ${data}`);
            });

            child.on('close', code => {
                if (code === 0) {
                    vscode.window.showInformationMessage(`Successfully installed R version: ${version}`);
                    updateStatusBar();
                    resolve();
                } else {
                    // If the exit code is 1, it's highly likely a password error with sudo.
                    if (code === 1) {
                        vscode.window.showErrorMessage(`Failed to install R ${version}. Incorrect password or permission error.`);
                    } else {
                        vscode.window.showErrorMessage(`Failed to install R version ${version}. See extension host logs for details. Exit code: ${code}`);
                    }
                    reject();
                }
            });

            child.on('error', err => {
                vscode.window.showErrorMessage(`Failed to start installation process: ${err.message}`);
                reject(err);
            });
        });
    });
}

/**
 * Uninstalls an R version using spawn to handle long-running processes that may require sudo.
 * It prompts the user for their password and pipes it to the sudo command.
 * @param {string} version - The version of R to uninstall (e.g., "4.3.1", "devel").
 */
async function uninstallWithProgress(version) {
    // Prompt the user for their password to use with sudo
    const password = await vscode.window.showInputBox({
        prompt: `Sudo password required to uninstall R ${version}`,
        password: true,
        ignoreFocusOut: true // Keep prompt open even if it loses focus
    });

    // If the user cancels the password prompt, do nothing.
    if (password === undefined) {
        vscode.window.showWarningMessage(`Uninstallation of R ${version} cancelled.`);
        return;
    }

    vscode.window.withProgress({
        location: vscode.ProgressLocation.Notification,
        title: `Uninstalling R version: ${version}`,
        cancellable: true
    }, (progress, token) => {
        // The command is `sudo`, with `-S` to read the password from stdin.
        // The arguments are the rest of the command.
        const child = spawn('sudo', ['-S', 'rig', 'rm', version]);

        return new Promise((resolve, reject) => {
            token.onCancellationRequested(() => {
                // Sending SIGTERM to the sudo process.
                child.kill();
                vscode.window.showWarningMessage(`Uninstallation of R ${version} cancelled.`);
                reject();
            });

            // Write the password to the stdin of the sudo command, followed by a newline.
            child.stdin.write(password + '\n');
            child.stdin.end();

            child.stdout.on('data', data => {
                // Report progress from the command's output
                const message = data.toString().trim().split('\n').pop();
                progress.report({ message });
            });

            child.stderr.on('data', data => {
                // Log stderr for debugging, but don't show it all to the user.
                // Specific errors are handled in the 'close' event.
                console.error(`stderr: ${data}`);
            });

            child.on('close', code => {
                if (code === 0) {
                    vscode.window.showInformationMessage(`Successfully uninstalled R version: ${version}`);
                    updateStatusBar();
                    resolve();
                } else {
                    // If the exit code is 1, it's highly likely a password error with sudo.
                    if (code === 1) {
                        vscode.window.showErrorMessage(`Failed to uninstall R ${version}. Incorrect password or permission error.`);
                    } else {
                        vscode.window.showErrorMessage(`Failed to uninstall R version ${version}. See extension host logs for details. Exit code: ${code}`);
                    }
                    reject();
                }
            });

            child.on('error', err => {
                vscode.window.showErrorMessage(`Failed to start uninstallation process: ${err.message}`);
                reject(err);
            });
        });
    });
}

/**
 * Launches an R console in the terminal.
 * It checks if the 'REditorSupport.r' extension is installed.
 * If yes, it uses that extension to launch the R console.
 * If no, it launches a basic R console using the default version from rig.
 * @param {boolean} forceNew - If true, disposes of any existing R console and creates a new one.
 */
function launchRConsole(forceNew = false) {
    const config = vscode.workspace.getConfiguration('rig-manager');
    if (!config.get('rConsole.autoLaunch')) {
        return; // Exit if auto-launch is disabled by the user
    }

    // Check if the REditorSupport.r extension is installed
    const rEditorSupport = vscode.extensions.getExtension('REditorSupport.r');

    if (rEditorSupport) {
        // If the R Editor Support extension is found, use its command to create an R terminal.
        // This provides a richer, more integrated experience.
        console.log('REditorSupport.r found. Handing off R terminal creation.');
        vscode.commands.executeCommand('r.createRTerm');
    } else {
        // If the R Editor Support extension is not found, fall back to the original behavior.
        console.log('REditorSupport.r not found. Launching a basic R console.');
        const R_CONSOLE_NAME = 'R Console';
        const existingTerminal = vscode.window.terminals.find(t => t.name === R_CONSOLE_NAME);

        // If the terminal already exists and we're not forcing a new one, do nothing.
        if (existingTerminal && !forceNew) {
            return;
        }

        // If we are forcing a new terminal, dispose of the old one first.
        if (existingTerminal && forceNew) {
            existingTerminal.dispose();
        }

        // Find the default R binary and launch it
        exec('rig list --json', (error, stdout, stderr) => {
            if (error) {
                vscode.window.showErrorMessage(`Could not launch R console. Error executing rig: ${stderr}`);
                return;
            }
            try {
                const versionsData = JSON.parse(stdout);
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
            } catch (e) {
                vscode.window.showErrorMessage(`Failed to parse rig output for R console: ${e.message}`);
            }
        });
    }
}

/**
 * Updates the status bar item with the current default R version.
 */
function updateStatusBar() {
    const config = vscode.workspace.getConfiguration('rig-manager');
    if (!config.get('statusBar.visible')) {
        rStatusBarItem.hide(); // Hide and exit if desabled by the user
        return;
    }

    exec('rig list --json', (error, stdout) => {
        if (error) {
            // If rig command fails, hide the status bar item
            rStatusBarItem.hide();
            return;
        }

        try {
            const versionsData = JSON.parse(stdout);
            const defaultVersion = versionsData.find(r => r.default === true);

            if (defaultVersion) {
                // Set the text to show the R version and a special icon
                rStatusBarItem.text = `$(versions) R: ${defaultVersion.version}`;
                rStatusBarItem.tooltip = `Default R Version: ${defaultVersion.name} (${defaultVersion.version})`;
                rStatusBarItem.show();
            } else {
                rStatusBarItem.text = `$(versions) R: Not set`;
                rStatusBarItem.tooltip = 'No default R version selected. Click to choose one.';
                rStatusBarItem.show();
            }
        } catch (e) {
            rStatusBarItem.hide();
            console.error(`Failed to parse rig output for status bar: ${e.message}`);
        }
    });
}

// This method is called when your extension is deactivated
function deactivate() {}

module.exports = {
    activate,
    deactivate
}

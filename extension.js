// The module 'vscode' contains the VS Code extensibility API
// Import the moduel and reference it with the aias vscode in your code below
const vscode = require('vscode');
// The 'chile_process' module allows us to execute shell commands
const { exec } = require('child_process');

/**
 * This method is called when your extension is activated.
 * Your extension is activated the very first time the command is executed.
 * @param {vscode.ExtensionContext} context
 */
function activate(context) {
	console.log('"rig-manager" is now active!');

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
                        });
                    }
                });
            } catch (e) {
                vscode.window.showErrorMessage(`Failed to parse rig output: ${e.message}`);
            }
        });
    });

    context.subscriptions.push(switchVersionDisposable);

    // The command to list installed R versions
    let listVersionsDisposable = vscode.commands.registerCommand('rig-manager.listVersions', function () {
        // Execute 'rig list --json' and show the formatted output
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

                // Format the JSON data into a human-readable string
                const formattedList = versionsData.map(r => {
                    const isDefault = r.default ? '*' : ' ';
                    const aliases = r.aliases.length > 0 ? `(${r.aliases.join(', ')})` : '';
                    return `${isDefault} ${r.name} ${aliases} - version ${r.version}`;
                }).join('\n');


                // Show the output in an information message.
                // Using a modal so the user has to acknowledge it.
                vscode.window.showInformationMessage(`Installed R Versions:\n${formattedList}`, { modal: true });

            } catch (e) {
                 vscode.window.showErrorMessage(`Failed to parse rig output: ${e.message}`);
            }
        });
    });

    context.subscriptions.push(listVersionsDisposable);
}

// This method is call when your extension is deactivated
function deactivate() {}

module.exports = {
	activate,
	deactivate
}

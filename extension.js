// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
const vscode = require('vscode');
// The 'child_process' module allows us to execute shell commands
const { exec } = require('child_process');

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

    // Add a command to refresh the status bar
    let refreshDisposable = vscode.commands.registerCommand('rig-manager.refresh', () => {
        updateStatusBar();
        vscode.window.showInformationMessage('R version status refreshed.');
    });
    context.subscriptions.push(refreshDisposable);

    // Update status bar on activation
    updateStatusBar();
}

/**
 * Updates the status bar item with the current default R version.
 */
function updateStatusBar() {
    exec('rig list --json', (error, stdout, stderr) => {
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

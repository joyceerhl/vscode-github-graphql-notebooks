import { Octokit } from '@octokit/core';
import fetch from 'node-fetch';
import * as vscode from 'vscode';
import { authentication, AuthenticationSession } from 'vscode';

export function activate(context: vscode.ExtensionContext) {
	context.subscriptions.push(new OctokitController());
}

// this method is called when your extension is deactivated
export function deactivate() {}


var authorizationScopes = vscode.workspace.getConfiguration('githubGraphql').get('scopes') as string[];

const variablesRegex = /^\s*variables\s*(\{[^}]*\})\s*$/m;

class OctokitController {
	private _octokit: Octokit | undefined;
	private _octokitDefaults: typeof Octokit | undefined;
	private _session: AuthenticationSession | undefined;
	private controller: vscode.NotebookController;

	constructor() {
		this.controller = vscode.notebooks.createNotebookController('github-graphql', 'gqlnb', 'GitHub GraphQL', (cells, notebook, c) => this.executeCells(cells, notebook, c));
		vscode.workspace.onDidChangeConfiguration((e) => {
			if (e.affectsConfiguration('githubGraphql')) {
				authorizationScopes = vscode.workspace.getConfiguration('githubGraphql').get('scopes') ?? []; // Update our cached auth scopes
				this.clearAuthenticationSession(); // Clear out the existing auth session if requested scopes changed
			}
		});
	}

	dispose() {
		return this.controller.dispose();
	}

	private async executeCells(cells: vscode.NotebookCell[], notebook: vscode.NotebookDocument, controller: vscode.NotebookController) {
		for (const cell of cells) {
			await this.executeCell(cell);
		}
	}

	private async executeCell(cell: vscode.NotebookCell) {
		const task = this.controller.createNotebookCellExecution(cell);
		task.start(Date.now());

		const contents = cell.document.getText();

		let code: string;
		let variables: Record<string, unknown> | undefined;
		const match = contents.match(variablesRegex);
		if (match) {
			try {
				variables = JSON.parse(match[1]);
			} catch (e) {
				replaceOutput(task, `Unable to parse 'variables': ${String(e)}`);
				task.end(false, Date.now());
				return;
			}

			code = contents.replace(variablesRegex, '').trim();
		} else {
			code = contents.trim();
		}

		let success = false;
		try {
			const resp = await this.graphql(code, variables);
			success = true;
			replaceOutput(task, resp);
		} catch (e) {
			replaceOutput(task, e);
		}
		task.end(success, Date.now());
	}

	private async graphql<T>(query: string, variables?: Record<string, unknown>): Promise<T | undefined> {
		if (this._octokit === undefined) {
			this._octokit = await this.octokit();
		}

		try {
			return await this._octokit.graphql<T>(query, variables);
		} catch (ex) {
			throw ex;
		}
	}

	private async octokit(options?: ConstructorParameters<typeof Octokit>[0]) {
		if (this._octokitDefaults === undefined) {
			const session = await this.ensureAuthenticated();

			if (vscode.env.uiKind === vscode.UIKind.Web) {
				async function fetchCore(url: string, options: { headers?: Record<string, string> }) {
					if (options.headers !== undefined) {
						const { 'user-agent': userAgent, ...headers } = options.headers;
						if (userAgent) {
							options.headers = headers;
						}
					}
					return fetch(url, options);
				}

				this._octokitDefaults = Octokit.defaults({
					auth: `token ${session.accessToken}`,
					request: { fetch: fetchCore },
				});
			} else {
				this._octokitDefaults = Octokit.defaults({ auth: `token ${session.accessToken}` });
			}
		}

		const octokit = new this._octokitDefaults(options);
		return octokit;
	}

	private async ensureAuthenticated(force: boolean = false) {
		if (this._session === undefined) {
			async function waitUntilAuthenticated() {
				try {
					const session = await authentication.getSession('github', authorizationScopes as readonly string[], {
						createIfNone: true,
					});
					if (session !== undefined) {
						return session;
					}
				} catch {}

				return new Promise<AuthenticationSession>(resolve => {
					async function getSession() {
						const session = await authentication.getSession('github', authorizationScopes as readonly string[], {
							createIfNone: true,
						});
						if (session !== undefined) {
							resolve(session);
						}
					}

					const disposable = authentication.onDidChangeSessions(async e => {
						if (e.provider.id === 'github') {
							disposable.dispose();
							await getSession();
						}
					});
				});
			}

			this._session = await waitUntilAuthenticated();
			const disposable = authentication.onDidChangeSessions(e => {
				if (this._session === undefined) {
					disposable.dispose();
					return;
				}

				if (e.provider.id === 'github') {
					this.clearAuthenticationSession();
					disposable.dispose();
				}
			});
		}

		return this._session;
	}

	private clearAuthenticationSession() {
		this._session = undefined;
		this._octokit = undefined;
		this._octokitDefaults = undefined;
	}
}


function replaceOutput(task: vscode.NotebookCellExecution, jsonData: unknown) {
	const stringified = JSON.stringify(jsonData, undefined, 4);
	let data;
	if (vscode.env.uiKind === vscode.UIKind.Web) {
		data = new TextEncoder().encode(stringified);
	} else {
		data = Buffer.from(stringified);
	}
	const item = new vscode.NotebookCellOutputItem(data, 'text/x-json');
	const output = new vscode.NotebookCellOutput([item]);
	task.replaceOutput(output);
}

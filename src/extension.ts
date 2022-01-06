import { Octokit } from '@octokit/core';
import fetch from 'node-fetch';
import * as vscode from 'vscode';
import { authentication, AuthenticationSession } from 'vscode';

export function activate(context: vscode.ExtensionContext) {
	const controller = new OctokitController();
	// Register notebook serializer
	const serializer = new NotebookSerializer();
	vscode.workspace.registerNotebookSerializer('github-graphql-nb', serializer);
	vscode.commands.registerCommand('github-graphql-nb.createnew', async () => {
		const data = serializer.createNew();
		const notebookDocument = await vscode.workspace.openNotebookDocument('github-graphql-nb', data);
		await vscode.commands.executeCommand('vscode.openWith', notebookDocument.uri, 'github-graphql-nb');
	});
}

// this method is called when your extension is deactivated
export function deactivate() {}


const authorizationScopes = ['repo', 'workflow'];

class NotebookSerializer implements vscode.NotebookSerializer {
	createNew(): vscode.NotebookData {
		const language = 'graphql';
		const cell = new vscode.NotebookCellData(vscode.NotebookCellKind.Code, '', language);
		return new vscode.NotebookData([cell]);
	}

	serializeNotebook(data: vscode.NotebookData, token?: vscode.CancellationToken): Uint8Array {
		const cells = data.cells.map((cell) => {
			return { code: cell.value, kind: cell.kind === vscode.NotebookCellKind.Markup ? 'markdown' : 'code' };
		});
		return new TextEncoder().encode(JSON.stringify({ cells }));
	}

	deserializeNotebook(content: Uint8Array, token: vscode.CancellationToken): vscode.NotebookData {
		const stringified = content.length === 0 ? new TextDecoder().decode(this.serializeNotebook(this.createNew())) : new TextDecoder().decode(content);
		const data = JSON.parse(stringified);
		if (!('cells' in data)) {
			throw new Error('Unable to parse provided notebook content, missing required `cells` property.');
		}
		if (!Array.isArray(data.cells)) {
			throw new Error('Unable to parse provided notebook contents, `cells` is not an array.');
		}
		const cells: (vscode.NotebookCellData | undefined)[] = data.cells.map((cell: unknown) => {
			if (typeof cell !== 'object' || cell === null) {
				return undefined;
			}
			if (cell.hasOwnProperty('code') && cell.hasOwnProperty('kind') && 'kind' in cell) {
				const graphqlCell = cell as unknown as { code: string, kind: 'markdown' | 'code' };
				return new vscode.NotebookCellData(graphqlCell.kind === 'code' ? vscode.NotebookCellKind.Code : vscode.NotebookCellKind.Markup, graphqlCell.code, 'graphql')
			}
		});
		const cellData = [];
		for (const cell of cells) {
			if (cell !== undefined) {
				cellData.push(cell);
			}
		}
		return new vscode.NotebookData(cellData);
	}
}

const variablesRegex = /^\s*variables\s*(\{[^}]*\})\s*$/m;

class OctokitController {
	private _octokit: Octokit | undefined;
	private _octokitDefaults: typeof Octokit | undefined;
	private _session: AuthenticationSession | undefined;
	private controller: vscode.NotebookController;

	constructor() {
		this.controller = vscode.notebooks.createNotebookController('github-graphql', 'github-graphql-nb', 'GitHub GraphQL', (cells, notebook, c) => this.executeCells(cells, notebook, c));
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
					const session = await authentication.getSession('github', authorizationScopes, {
						createIfNone: true,
					});
					if (session !== undefined) return session;
				} catch {}

				return new Promise<AuthenticationSession>(resolve => {
					async function getSession() {
						const session = await authentication.getSession('github', authorizationScopes, {
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
	let data;
	if (vscode.env.uiKind === vscode.UIKind.Web) {
		data = new TextEncoder().encode(JSON.stringify(jsonData));
	} else {
		data = Buffer.from(JSON.stringify(jsonData, undefined, 4));
	}
	const item = new vscode.NotebookCellOutputItem(data, 'application/json');
	const output = new vscode.NotebookCellOutput([item]);
	task.replaceOutput(output);
}

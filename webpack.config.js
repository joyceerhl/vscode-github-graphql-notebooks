//@ts-check
/** @typedef {import('webpack').Configuration} WebpackConfig **/

'use strict';

const path = require('path');

async function getExtensionConfig(target, mode, env) {
  return {
    name: `extension:${target}`,
    entry: './src/extension.ts', 
    target: target,
    mode: mode,
    devtool: 'nosources-source-map',
    externals: {
      vscode: 'commonjs vscode' // the vscode-module is created on-the-fly and must be excluded. Add other modules that cannot be webpack'ed, 📖 -> https://webpack.js.org/configuration/externals/
      // modules added here also need to be added in the .vsceignore file
    },
    output: {
      path: target === 'webworker' ? path.join(__dirname, 'dist', 'browser') : path.join(__dirname, 'dist'),
      filename: 'extension.js',
      libraryTarget: 'commonjs2'
    },
    resolve: {
      // support reading TypeScript and JavaScript files, 📖 -> https://github.com/TypeStrong/ts-loader
      extensions: ['.ts', '.js'],
      alias:
        target === 'webworker' ? { 'node-fetch': 'cross-fetch' } : undefined,
    },
    module: {
      rules: [
        {
          test: /\.ts$/,
          exclude: /node_modules/,
          use: [
            {
              loader: 'ts-loader'
            }
          ]
        }
      ]
    }
  };
}

module.exports = 	/**
* @param {{ esbuild?: boolean; } | undefined } env
* @param {{ mode: 'production' | 'development' | 'none' | undefined; }} argv
* @returns { Promise<WebpackConfig[]> }
*/
async function (env, argv) {
 const mode = argv.mode || 'none';

 env = {
   esbuild: false,
   ...env,
 };

 return Promise.all([
   getExtensionConfig('node', mode, env),
   getExtensionConfig('webworker', mode, env),
 ]);
};

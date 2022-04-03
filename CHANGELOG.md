# Change Log

## [0.1.0] - 2022-04-03

- Serializer has moved to the VS Code GraphQL Notebook extension, which remains compatible with VS Code for the Web. You can continue to open `*.github-graphql-nb` files with the generic GraphQL notebook serializer
- This extension now provides a convenience layer for running GitHub API queries as an alternative to configuring an endpoint using a `graphql-config` file

## [0.0.7] - 2022-02-09

- Use `rebornix.vscode-code-renderer` extension to render JSON notebook output
- Fix GraphQL language configuration

## [0.0.6] - 2022-02-03

- Add missing JSON indentation on web

## [0.0.5] - 2022-01-09

- This extension now works in https://vscode.dev and https://github.dev
- github-graphql-nb file types now open in the notebook UI by default

## [0.0.4] - 2022-01-06

- Markdown cells now render correctly

## [0.0.3] - 2022-01-06

- You can now use variables with your queries as follows:

  ```graphql
  query ($owner: String!,	$repo: String!) {
    repository(owner: $owner, name: $repo) {
        name
    }
  }

  variables {
    "owner": "eamodio",
    "repo": "vscode-gitlens"
  }
  ```

  (Thanks [@eamodio](https://github.com/eamodio)!)

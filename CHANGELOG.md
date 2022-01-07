# Change Log

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
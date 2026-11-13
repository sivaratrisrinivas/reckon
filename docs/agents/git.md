# GitHub pushes

When a task includes a GitHub push, run `gh auth status` early to identify authentication problems before finishing the work. A successful check is not a guarantee that the push will be authorized; use the configured Git remote and handle any push error.

If authentication is missing or invalid, ask the user to run `gh auth login -h github.com -p https -w` and `gh auth setup-git`. In WSL, if the browser does not open, open the URL printed by the CLI in Windows and enter the one-time code there. Never request a personal access token in chat.

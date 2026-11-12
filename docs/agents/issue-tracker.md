# Issue tracker: GitHub

Issues and specs live in GitHub Issues for sivaratrisrinivas/reckon.
Use the gh CLI from this repository.

- Create: gh issue create --title "..." --body-file <file>
- Read: gh issue view <number> --json number,title,body,labels,comments
- List: gh issue list --state open --json number,title,body,labels
- Comment: gh issue comment <number> --body-file <file>
- Label: gh issue edit <number> --add-label "..." --remove-label "..."
- Close: post an explanation, then run gh issue close <number>.

Before creating issues, verify the target with
gh repo view --json nameWithOwner. File only into the user's repo.

Use native GitHub sub-issues and issue dependencies when available.
Otherwise, record "Part of #<parent>" and "Blocked by: #<number>"
at the top of the child issue body.
An issue is unblocked when all its blockers are closed.

## Pull requests as a triage surface

PRs as a request surface: no.

## Skill operations

"Publish to the issue tracker" means create a GitHub issue.
"Fetch the relevant ticket" means read the GitHub issue.

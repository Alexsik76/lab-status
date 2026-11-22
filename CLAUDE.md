# Agent instructions for lab-status

Standing rules for coding agents working in this repository. They apply to every task.

## Report in the pull request, not only in the chat

The reviewer reads the pull request, not the agent's conversation. The PR description is the
full report, containing everything that would be told in the chat:

- what was done;
- what deviates from the brief, and why;
- what was verified, and how (tests, browser checks, live data);
- what could not be verified, and why;
- measurements on live data (sizes, counts, payload sizes and the like);
- known defects and open questions;
- where screenshots are kept (see below).

Update the description on every push to the branch so that it always describes the current
state of the branch. Rewrite it; do not append a changelog.

For a stopped or abandoned task, say so in a comment on its PR; if there is no PR, say so in
the chat only.

## Keep live data out of the repository and its PRs

The repository and its pull requests are public.

- Fixtures and tests use invented names, SSIDs, MACs, addresses, areas and models.
- PR descriptions, comments and commit messages never contain real SSIDs, device names,
  addresses, VLAN names or other details of the live lab. Describe them in general terms
  ("the camera switch", "a 5 GHz network", "VLAN <id> <name>").
- Screenshots of live data are not attached to PRs or committed. Keep them outside the
  repository and say in the PR where they are (e.g. `~/work/.playwright/<name>.png` on the
  agent VM).

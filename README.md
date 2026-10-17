# Claude Usage Meter

A Claude Code mod that adds a **Claude Usage** side pane:

- 5-hour and weekly plan limits: percent used, a color bar, and time until reset
- This session's cost in dollars
- How full the conversation's context is
- A pop-up warning when a limit passes 80% and again at 95% (once per limit window)
- `/usage` reopens the pane if you close it

Plan limits show on Pro, Max and Team plans after Claude's first reply in a session.

## Install

At the prompt of a Claude Code terminal session:

```
/plugin install usage-meter --marketplace peterson-engineering/general
```

Answer `y` to add the marketplace, then pick a scope.

From a shell:

```
claude plugin install usage-meter --marketplace peterson-engineering/general
```

In the desktop app: click **+** next to the prompt box, then **Plugins**, **Add marketplace** with `peterson-engineering/general`, then **Add plugin**.

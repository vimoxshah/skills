Output demo.gif

Set Shell bash
Set FontSize 17
Set Width 1420
Set Height 600
Set Padding 26
Set TypingSpeed 45ms
Set Framerate 24
Set Theme { "background": "#0B132B", "foreground": "#EAF4F4", "cursor": "#6FFFE9", "selection": "#1C2541", "black": "#0B132B", "red": "#EE4266", "green": "#6FFFE9", "yellow": "#FFD23F", "blue": "#70D6FF", "magenta": "#C77DFF", "cyan": "#5BC0BE", "white": "#EAF4F4", "brightBlack": "#3B5183", "brightRed": "#EE4266", "brightGreen": "#6FFFE9", "brightYellow": "#FFD23F", "brightBlue": "#70D6FF", "brightMagenta": "#C77DFF", "brightCyan": "#5BC0BE", "brightWhite": "#FFFFFF" }

# ---- hidden setup: fresh fake home, warm the clone, then unlink so the
# ---- visible run shows pure "link" lines without git's clone chatter
Hide
Type "export PATH=/Users/vimoxshah/.nvm/versions/node/v24.13.1/bin:$PATH" Enter
Type "export DEMO=/tmp/skills-demo-home" Enter
Type "rm -rf $DEMO && mkdir -p $DEMO/.claude $DEMO/.codex $DEMO/.cursor" Enter
Type "export HOME=$DEMO" Enter
Type "cd $HOME" Enter
Type "npx -y @vimoxshah/skills --yes --bundles core --harness claude,codex,cursor > /dev/null 2>&1" Enter
Sleep 25s
Type "npx -y @vimoxshah/skills uninstall --yes > /dev/null 2>&1" Enter
Sleep 12s
Type "export PS1='$ '" Enter
Type "clear" Enter
Show

Sleep 900ms
Type "npx @vimoxshah/skills --yes --bundles core --harness claude,codex,cursor"
Sleep 500ms
Enter
Sleep 9s
Sleep 2500ms

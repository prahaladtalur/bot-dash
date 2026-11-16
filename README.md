# bot-dash

Public, read-only paper-trading dashboard for two Solana copy/scan bots.

The page is static. A separate `data` branch holds a sanitised `dashboard.json` that the page refreshes on its own. If that file is more than 20 minutes old, the page shows **BOT OFFLINE / HOST ASLEEP**.

Amounts are US dollars shown with the label **ETH**. Nothing is converted: 1 ETH on this page equals $1.

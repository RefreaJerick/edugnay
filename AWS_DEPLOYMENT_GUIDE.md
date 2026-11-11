# Academix AWS deployment guide

This guide is for the Academix test deployment that is already running in AWS. It is written for someone new to deployment. Keep it with your project and use it as a checklist.

**Do not put passwords, API keys, or your `.pem` private key in this file, GitHub, screenshots, or chat.** The commands below ask for database passwords privately when needed.

## 1. How this deployment is connected

```text
Your browser
    ↓ HTTPS
academix-test.duckdns.org
    ↓
Nginx on the EC2 server
    ↓
Academix Node.js app on port 3000
    ↓ private connection
MariaDB database on RDS
```

EC2 is the Linux server that runs Academix. RDS is the separate managed database. The database is private; it is reached from the EC2 server, not directly from the public internet.

## 2. Current deployment details

These are identifiers and addresses, not passwords:

| Item | Current value |
|---|---|
| AWS Region | Asia Pacific (Sydney), `ap-southeast-2` |
| EC2 instance name | `academix-test` |
| EC2 instance ID | `i-0890ba9acf31b7906` |
| EC2 operating system | Ubuntu 26.04 |
| App folder on EC2 | `/home/ubuntu/academix/backend` |
| Public app address | [https://academix-test.duckdns.org](https://academix-test.duckdns.org) |
| App health check | [https://academix-test.duckdns.org/api/health](https://academix-test.duckdns.org/api/health) |
| RDS instance name | `academix-test-db` |
| Database name | `academix` |
| RDS endpoint | `academix-test-db.cz6y4ye4eky3.ap-southeast-2.rds.amazonaws.com` |
| Code repository | [github.com/RefreaJerick/edugnay](https://github.com/RefreaJerick/edugnay) |

The EC2 public IP was `3.24.212.0` when this guide was written. It can change if the instance is stopped and started. The DuckDNS address must point to the current IP.

The platform administrator account has already been created. Use the sign-in details you chose; they are deliberately not written here.

## 3. Open a terminal on the EC2 server

Use **EC2 Instance Connect** in the AWS website. This opens a terminal in your browser; you do not need to open PowerShell or use the `.pem` file for this method.

1. Sign in to the [AWS Management Console](https://console.aws.amazon.com/).
2. In the Region menu at the top right, select **Asia Pacific (Sydney)** (`ap-southeast-2`).
3. Use the AWS search box to open **EC2**.
4. In the left menu, choose **Instances**.
5. Find `academix-test` and check that its state is **Running**.
6. Select its row, then choose **Connect**.
7. Open the **EC2 Instance Connect** tab. Leave the username as `ubuntu`.
8. Choose **Connect**. A browser terminal should open with a prompt like `ubuntu@ip-...:~$`.

When you are finished, type `exit` in that terminal. Closing the AWS browser tab also closes your terminal session. It does **not** stop the EC2 server or the Academix app.

If the browser connection times out, check the instance is running, then check its security group has an inbound SSH rule for port 22 from the AWS managed EC2 Instance Connect prefix list for `ap-southeast-2`. Do not make SSH open to everyone (`0.0.0.0/0`). AWS explains this requirement in its [EC2 Instance Connect prerequisites](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/ec2-instance-connect-prerequisites.html).

### Optional: connect from Windows PowerShell instead

This method uses the private key file downloaded when the EC2 instance was created. Keep that `.pem` file private. The SSH rule must allow your computer's **current public IP** ending in `/32`; your internet provider or hotspot can change that IP. Browser EC2 Instance Connect is usually simpler. Never open SSH to all IP addresses.

## 4. Open Academix and check whether it is healthy

Open [https://academix-test.duckdns.org](https://academix-test.duckdns.org) in a browser. The health address should return a short JSON message showing the database is connected:

```text
https://academix-test.duckdns.org/api/health
```

From the EC2 terminal, run:

```bash
sudo systemctl status academix --no-pager
curl -sS http://127.0.0.1:3000/api/health
```

The service should say `active (running)`. The health response should include `"database":"connected"`.

Useful service commands:

```bash
sudo systemctl restart academix
sudo systemctl status academix --no-pager
sudo journalctl -u academix -n 100 --no-pager
```

The app is managed by `systemd`, which starts it again after a server reboot and restarts it if it crashes. Do not start another copy with `nohup npm start`; that can compete for port 3000.

If the website shows **502 Bad Gateway**, Nginx cannot reach the app. First check `sudo systemctl status academix --no-pager`, then inspect `sudo journalctl -u academix -n 100 --no-pager`. Also check the local health command above. Nginx errors can be viewed with:

```bash
sudo tail -n 50 /var/log/nginx/error.log
```

## 5. View and manage the database

### What the two logins mean

- Your **Academix platform-admin login** is for signing in to the website and managing Academix.
- Your **RDS database login** is for the MariaDB database. It is different from your platform-admin login.

Use Academix screens for normal school work. Directly changing database rows can break related records, so use SQL only when you understand the exact change and have a backup plan.

### Connect to MariaDB from the EC2 terminal

Run this command on the **EC2 terminal**, not in Windows PowerShell and not in the AWS website search box:

```bash
mariadb -h academix-test-db.cz6y4ye4eky3.ap-southeast-2.rds.amazonaws.com -P 3306 -u academix040705 -p --ssl-ca="$HOME/rds-global-bundle.pem" --ssl-verify-server-cert academix
```

At `Enter password:`, type the RDS database password and press Enter. The password will not appear as you type. When connected, MariaDB shows a prompt such as `MariaDB [academix]>`.

Safe commands for looking around:

```sql
SHOW TABLES;
SELECT COUNT(*) FROM users;
SELECT id, email, role FROM users LIMIT 20;
```

To leave MariaDB, type:

```sql
exit
```

Avoid `DROP`, `DELETE`, `TRUNCATE`, or broad `UPDATE` commands unless you have checked the exact rows and have a recovery plan.

### RDS console: see database status and settings

1. In AWS, confirm the Region is **Asia Pacific (Sydney)**.
2. Search for **RDS** or open **Aurora and RDS**.
3. Choose **Databases**, then `academix-test-db`.
4. The details page shows status, engine version, endpoint, backups, and connectivity settings. It does not show or edit application rows like students or classes; use the MariaDB connection above for that.

RDS is intentionally private. Do not turn on public access just to connect from your laptop. Connect through EC2 or set up a properly secured tunnel if you later need a desktop database tool.

### Backups before database changes

The database was configured with automated backup retention of **7 days**. Check **RDS → Databases → academix-test-db → Maintenance & backups** to confirm its current setting.

Before a significant database change, create a manual RDS snapshot if the AWS console shows that its cost fits your free-plan credits. In RDS, select `academix-test-db`, choose **Actions → Take snapshot**, give it a clear name with the date, and wait until the snapshot is available. AWS's [snapshot guide](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/USER_CreateSnapshot.html) explains the process. A snapshot is a recovery point; it does not automatically undo a change.

## 6. Publish code changes from GitHub to EC2

**Pushing code to GitHub does not automatically update this EC2 server.** The current deployment is updated manually.

### A. On your own computer

1. Open the project in VS Code.
2. Make and save the code changes.
3. Run the checks appropriate to those changes.
4. Commit the changes and push them to the GitHub `main` branch. In VS Code, use **Source Control** to review, commit, and push. Do not push `.env`, passwords, API keys, or `.pem` files.

### B. Connect to EC2 and check before pulling

In EC2 Instance Connect, run:

```bash
cd ~/academix
git status --short
```

If `git status --short` prints any files, **stop and review them before pulling**. A previous `npm audit fix --omit=dev` was run on this server and may have changed the lock file. Do not use `git reset --hard`, `git clean`, or overwrite those changes just to make a pull work.

If the status is clean, get the code:

```bash
git pull --ff-only origin main
git log -1 --oneline
```

If the update changed `backend/package.json` or `backend/package-lock.json`, install the locked production packages:

```bash
cd ~/academix/backend
npm ci --omit=dev
```

Then restart and check the service:

```bash
sudo systemctl restart academix
sleep 5
sudo systemctl status academix --no-pager
curl -sS http://127.0.0.1:3000/api/health
```

Finally, open the public website and check the part you changed. If it fails, inspect `sudo journalctl -u academix -n 100 --no-pager` and the Nginx error log.

## 7. Database changes and migrations

The fresh database setup has already been imported. The repository's current fresh-install files have this purpose:

- `backend/database/schema.sql` creates the database structure through migration **066**.
- `backend/database/reference-data.sql` adds the built-in template records associated with migrations **067–068**.

**Do not re-import these files into the live database.** They are for a fresh empty database. Re-importing them is not the way to update a deployed database.

For a future database change:

1. The code change should include a new numbered SQL migration (the next number after 068, if no newer migration has been added).
2. Read `backend/database/README.md` and the migration file before applying it.
3. Check the EC2 repository status and pull the reviewed update.
4. Back up the RDS database first. Check the cost of a manual snapshot against the account's credits.
5. Connect to MariaDB from EC2 and apply **only the new migration**, exactly once, using the project's database instructions.
6. Deploy/restart the app code and check the health address and the changed feature.

The app does not automatically run numbered SQL migrations when it starts. Restarting Academix alone does not update the database. Do not replay historical migrations 001–068 against this already-created database.

## 8. Environment settings, email, AI, and SMS

The server's private settings file is:

```text
/home/ubuntu/academix/backend/.env
```

Open it only from the EC2 terminal:

```bash
cd ~/academix/backend
nano .env
```

In Nano, save with **Ctrl+O**, press **Enter**, and exit with **Ctrl+X**. After changing an app setting, restart the app with `sudo systemctl restart academix` and check health again. Never copy the file into GitHub or send it in a screenshot.

Email was tested and worked during setup. **OpenAI and Semaphore have not been connected to the app yet.** Their keys are not included in this guide. AI report generation and release were left disabled. Keep them disabled until the school approves sending learner information to the AI provider and the feature has been tested. Get parent/guardian consent before sending report SMS. Provider credits are separate from AWS credits; check that automatic top-ups are off if you want to avoid additional charges.

The app service currently has `DISABLE_BACKGROUND_WORKERS=true`. That disables scheduled background work. Do not simply change it to `false` to turn on SMS: it can enable other background jobs too, such as scheduled email and push work. Before enabling workers, review pending queues and test each provider and job deliberately.

## 9. Domain, HTTPS, and changing IP addresses

The public test address is `academix-test.duckdns.org`. DuckDNS points that name at the EC2 public IP. If the EC2 IP changes:

1. In EC2, open the `academix-test` instance details and copy its current **Public IPv4 address**.
2. Sign in to DuckDNS and update the `academix-test` record to that address.
3. Wait for DNS to update, then open the HTTPS site and health address again.

The HTTPS certificate was issued with Certbot and automatic renewal was configured. Renewals need the domain to point to this server and the web server to be reachable.

## 10. AWS costs and safe shutdown

- The AWS page showed this account on the **Free plan**. Check **Billing and Cost Management → Credits / Bills** periodically. AWS credits and free-plan limits can run out; provider credits for OpenAI or Semaphore do not pay AWS charges.
- Do not upgrade the AWS account or add a paid AWS service unless you decide to do that.
- Closing browser windows or typing `exit` only closes your console session. It does not stop the app.
- Stopping EC2 makes the website unavailable. Starting it again may give it a new public IP, so DuckDNS may need an update.
- RDS is a separate service and can keep running even while EC2 is stopped. Check both resources and the billing page if you are pausing the test.
- Do not choose **Terminate** for the EC2 instance or **Delete** for the RDS database as a way to pause. Termination/deletion can remove the server or database. An RDS backup does not necessarily include files uploaded to EC2.

## 11. Quick help checklist

| What you see | First check |
|---|---|
| Website works, but a feature fails | Check the Academix page, then `sudo journalctl -u academix -n 100 --no-pager` |
| `502 Bad Gateway` | `sudo systemctl status academix --no-pager`, then local health check and app logs |
| Health says database is not connected | Check service logs and the private `.env`; do not make RDS public |
| EC2 Instance Connect times out | Confirm Sydney Region, instance is Running, and port 22 allows the Sydney EC2 Instance Connect prefix list |
| PowerShell SSH times out | Confirm port 22 allows your current public IP `/32`; your IP may have changed |
| Domain does not open after EC2 restart | Check EC2's current public IP and update the DuckDNS record |
| `git pull` refuses due to local changes | Stop and review `git status --short`; do not discard files blindly |

## 12. Official AWS references

- [Connect using EC2 Instance Connect](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/ec2-instance-connect-methods.html)
- [EC2 Instance Connect security-group requirements](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/ec2-instance-connect-prerequisites.html)
- [Create an RDS database snapshot](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/USER_CreateSnapshot.html)

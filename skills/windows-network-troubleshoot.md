# AI PC Agent Skill File v1

# Windows Network Troubleshooting Skill

## Use When
- User reports disconnected internet, high latency, DNS issues, VPN problems.

## Workflow
1. Classify symptom: no network / unstable / slow / name resolution.
2. Check IP, gateway, DNS, adapter status.
3. Run safe diagnostics before reset.
4. Propose fixes from low-risk to high-risk.

## Diagnostics
- `ipconfig /all`, gateway ping, DNS resolve checks.
- Adapter reset only after user approval.

## Safety
- Explain impact before network stack reset.

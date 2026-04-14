---
name: virtualization-sandbox
description: Prepare and manage a VM sandbox for isolated task execution. Use when a task should be isolated from the host, or when the user wants to test an unknown installer, risky script, or compatibility scenario.
license: Proprietary
compatibility: Windows 10/11 with VirtualBox (or compatible hypervisor) installed.
metadata:
  author: anomixer
  version: "1.0"
  tags: virtualbox vm sandbox isolation computer-use risky
---

## When to Use

- The task involves an unknown or untrusted installer.
- The user wants to test risky scripts or environment changes without affecting the host.
- Computer Use actions require a safe execution environment.
- Compatibility testing across OS versions is needed.

## Workflow

1. **Check hypervisor availability**: verify VirtualBox (or Hyper-V) is installed and running.
2. **If missing**: suggest install via SOP → `[ACTION:ADD_TASK sop_id="install-virtualbox"]`.
3. **Prepare VM sandbox**: use `prepare_vm_sandbox` Computer Use action.
4. **Run workload inside VM**: collect success/failure outcome.
5. **Report results to host**: deliver summary and any artefacts.

## Action Protocol

```
[ACTION:COMPUTER_USE action="prepare_vm_sandbox"]
[ACTION:COMPUTER_USE action="open_file" path="C:\\path\\to\\installer.exe"]
[ACTION:ADD_TASK sop_id="install-virtualbox"]
```

## Policy

- **VM-first** for high-risk or untrusted software tasks – never run unknown code on the host without consent.
- Destroy or snapshot-rollback the VM after testing to prevent persistent changes.
- Document the test outcome before reporting to the user.

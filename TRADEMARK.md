# Trademark policy

The **code** in this repository is licensed under the Apache License 2.0. See [LICENSE](LICENSE).

The **name "OpenManga"**, and any OpenManga logo or wordmark, are **not** covered by that licence. Apache-2.0 §6 is
explicit about this: the licence "does not grant permission to use the trade names, trademarks, service marks, or
product names of the Licensor". This file states the resulting policy rather than adding a new restriction.

## What you may do without asking

- Use, modify, run and redistribute the software under Apache-2.0, including commercially.
- Say truthfully what your thing is: "based on OpenManga", "a fork of OpenManga", "compatible with OpenManga",
  "OpenManga running on my own server". Accurate, descriptive references are fine and always will be.
- Link to the project, write about it, review it, and use the name in documentation, articles, talks and comparisons.
- Run a private or internal instance under any name you like.

## What needs permission

- Naming a fork, a distribution, a hosted service or a product **"OpenManga"**, or a name close enough to be mistaken
  for it. **Forks that are distributed publicly must rebrand** — pick your own name and your own logo.
- Using the name or logo in a way that suggests the project endorses, maintains, supports or is affiliated with what
  you are offering, when it does not.
- Using the name or logo as your own trademark, product name, company name, app store listing name, or domain name
  where it would be read as the project itself.
- Modifying the logo, or using it as the icon or mark for something that is not this project.

The practical test is confusion: someone should never think they are getting the OpenManga project when they are
getting yours, and should never think the project stands behind something it has not seen.

## Rebranding a fork

Everything a rebrand touches is in the repository and is meant to be changed: the project name in `package.json` and
the workspace package scope, the Docker image and compose service names, the application title in the web client, and
the documentation. Nothing in the code depends on the name.

Keep the [LICENSE](LICENSE) and [NOTICE](NOTICE) files and the attributions in them — Apache-2.0 §4 requires that,
and the font licences in `licenses/` have their own requirements. Removing the name is expected; removing the
attributions is not.

## Asking

For permission requests, and for anything this policy does not obviously cover, open an issue, or email the address
listed in [SECURITY.md](SECURITY.md).

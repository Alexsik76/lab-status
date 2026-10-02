# lab-status

Status page of the home lab: physical nodes, the VMs and LXC containers on them,
and the Docker containers inside those VMs, each with its current state.

The page is a static site (HTML, CSS, JavaScript). State is not polled in the
background: it is requested from n8n when the page is opened.

Current content of `site/` is a placeholder used to verify the deployment path.

## Layout

| Path | Purpose |
|---|---|
| `docker-compose.yml` | one service: the unmodified `nginx` image serving `site/` |
| `site/` | the site itself: `index.html`, styles, scripts |

## Deployment

Deployed as a Portainer stack from this Git repository with
**Enable relative path volumes** turned on. Portainer clones the repository to a
directory on the host, so `./site` resolves to a real path and can be mounted
into the container. Without that option the mount would be an empty directory.

- Host: VM `portainer`, container port published on `8081`
- Address: `https://status.lab.vn.ua` (proxy host in Nginx Proxy Manager)

## Updating

1. `git push`
2. In Portainer, open the stack and use **Pull and redeploy**

No image is built and nothing is copied to the host by hand.

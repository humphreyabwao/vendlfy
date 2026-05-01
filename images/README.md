# Images

Static image assets served alongside the app. Reference them from the UI as
relative paths, e.g. `images/logo/main-logo.png`.

## Folder layout

| Folder       | Use for                                                      |
| ------------ | ------------------------------------------------------------ |
| `logo/`      | Brand / business logos (used by the Brand settings tab, login screen, receipt previews). |
| `products/`  | Inventory product photos.                                    |
| `users/`     | User avatars / profile pictures.                             |
| `ventures/`  | Side-business photos (gambling, M-Pesa, kanyonde, etc.).     |
| `tenants/`   | Tenant photos / unit photos.                                 |
| `misc/`      | Anything else (banners, icons, illustrations).               |

## Recommended formats

- **Logo / icons:** SVG or PNG with transparent background.
- **Photos:** JPEG (`.jpg`) for best size; PNG only when transparency is needed.
- **Hero images:** WebP for modern browsers; JPEG fallback if needed.

## Sizing

Keep raw uploads under **1 MB** when possible. The app does not currently
auto-resize, so over-sized images will slow page loads. For receipts and
thumbnails, target 256–512 px on the longest edge.

## Linking from code

```html
<img src="images/logo/main-logo.png" alt="Brand logo">
```

Because everything in `vendlfy/` is the Firebase Hosting public root, these
paths work both in development and after deploy.

## Cloud uploads

User-uploaded images (e.g. product photos, tenant uploads) should be sent to
**Firebase Storage**, not committed to this folder. This folder is only for
static, version-controlled assets that ship with the app.

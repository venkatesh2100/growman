# Images and storage

Say this first: the database stores a key such as `products/130239.jpg`. The URL is built at read time from `IMAGE_BASE_URL`. Swapping buckets does not rewrite every product row.

## Why a key

`image_key` on products, sizes, reviews, and order items is a path, not `https://storage.googleapis.com/...`. `internal/services/storage` turns the key into a URL when the JSON is assembled. Order items copy the key at checkout, so the receipt still resolves if the product is later deleted, as long as the object remains.

Alternative: store the full URL. Then a CDN domain change is a migration across every row, and a private bucket cannot change signing rules without a rewrite.

## Where the bytes go

Google Cloud Storage when `IMAGE_BASE_URL` and the bucket credentials are set. If init fails, `main.js` logs and continues with uploads disabled. The catalog still serves keys that already resolve, or omits images. The shop does not refuse to boot because a bucket is misconfigured.

Admin upload is `POST /api/v1/images/upload` behind the admin middleware. Customer plant photos use `POST /api/v1/me/images` behind a full JWT. Those are different authorization checks on purpose. A shopper must not write the catalog prefix.

Sharp resizes before upload so a phone photo is not stored at full sensor size. The optimizer lives in `internal/services/storage/imageopt.js`.

## Why not on the API disk

Cloud Run (or any second replica) does not share a disk. An upload on instance A would 404 on instance B. Object storage is the shared disk. The database only remembers the name.

## Interview line

“Images are content-addressed by a key we own. The URL is a view. The order snapshots the key, not a join to the live product.”

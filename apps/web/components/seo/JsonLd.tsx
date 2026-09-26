import type { JsonLdObject } from "../../lib/seo/jsonLd";

/**
 * Serialise structured data safely. `<` is escaped so a product name or
 * description containing markup can never break out of the script element.
 */
function serialize(data: JsonLdObject | JsonLdObject[]): string {
  return JSON.stringify(data).replace(/</g, "\\u003c");
}

/**
 * Renders one or more JSON-LD graphs. Server-rendered so the markup is present
 * in the initial HTML that crawlers read.
 */
export default function JsonLd({
  data,
  id,
}: {
  data: JsonLdObject | JsonLdObject[];
  id?: string;
}) {
  return (
    <script
      type="application/ld+json"
      id={id}
      // Content is produced by our own typed builders and escaped above.
      dangerouslySetInnerHTML={{ __html: serialize(data) }}
    />
  );
}

import { Suspense } from "react"
import type { Metadata } from "next"
import Searchcomponent from "./searchComponent"

/**
 * Internal search results are noindex: `?q=` combinations would otherwise
 * generate an unbounded number of thin, near-duplicate URLs. `follow` is kept
 * so crawlers still traverse to the real product pages from here.
 */
export const metadata: Metadata = {
  title: "Search Plants",
  description: "Search the Growman plant catalog.",
  robots: { index: false, follow: true },
}

export default function SearchPage(){
  return(
    <main>
      <Suspense fallback={<div> Loading ..</div>}>

        <Searchcomponent/>

      </Suspense>
    </main>
  )
}

import { Suspense } from "react"
import Searchcomponent from "./searchComponent"


export default function SearchPage(){
  return(
    <Suspense fallback={<div> Loading ..</div>}>

      <Searchcomponent/>

    </Suspense>


  )
}
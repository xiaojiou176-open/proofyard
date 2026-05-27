import assert from "node:assert/strict"
import test from "node:test"
import React from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { Button } from "./button.js"

test("Button renders variant/size classes and defaults type=button", () => {
  const markup = renderToStaticMarkup(
    <Button variant="destructive" size="icon" className="custom-button">
      Delete
    </Button>
  )

  assert.match(markup, /type="button"/)
  assert.match(markup, /ui-button/)
  assert.match(markup, /ui-button--destructive/)
  assert.match(markup, /ui-button--icon/)
  assert.match(markup, /custom-button/)
})

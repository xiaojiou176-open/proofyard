import { expect, test } from "@playwright/experimental-ct-react"
import CounterCardFixture from "../../src/testing/CounterCardFixture"

test("counter card responds to click actions", async ({ mount }) => {
  const component = await mount(<CounterCardFixture title="CT Counter" />)
  await expect(component.getByTestId("counter-value")).toHaveText("0")

  await component.getByTestId("counter-inc").click()
  await expect(component.getByTestId("counter-value")).toHaveText("1")

  await component.getByTestId("counter-reset").click()
  await expect(component.getByTestId("counter-value")).toHaveText("0")
})

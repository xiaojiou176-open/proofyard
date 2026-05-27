import assert from "node:assert/strict"
import test from "node:test"
import React from "react"
import { renderToStaticMarkup } from "react-dom/server"
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
  Checkbox,
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogOverlay,
  DialogPortal,
  DialogTitle,
  DialogTrigger,
  Input,
  Select,
  Switch,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  Textarea,
  Toast,
  ToastIcon,
  ToastMessage,
  ToastViewport,
  cn,
} from "./index.js"

type ForwardRefRender = {
  render: (props: Record<string, unknown>, ref: unknown) => { props: Record<string, unknown> }
}

test("ui primitives render classes and default semantics", () => {
  const markup = renderToStaticMarkup(
    <div>
      <Badge variant="warning">warn</Badge>
      <Card tone="raised">
        <CardHeader>header</CardHeader>
        <CardTitle>title</CardTitle>
        <CardDescription>desc</CardDescription>
        <CardContent>content</CardContent>
        <CardFooter>footer</CardFooter>
      </Card>
      <Dialog open={false} />
      <DialogPortal>
        <DialogTrigger>open</DialogTrigger>
        <DialogClose>close</DialogClose>
        <DialogHeader />
        <DialogTitle />
        <DialogDescription />
        <DialogFooter />
      </DialogPortal>
      <Input />
      <Textarea />
      <Select size="sm">
        <option value="a">a</option>
      </Select>
      <Tabs>
        <TabsList />
        <TabsTrigger active={true}>
          tab
        </TabsTrigger>
        <TabsContent>panel</TabsContent>
      </Tabs>
      <ToastViewport />
      <Toast level="error">toast</Toast>
      <ToastIcon />
      <ToastMessage>message</ToastMessage>
      <Button variant="secondary">btn</Button>
    </div>
  )

  assert.match(markup, /ui-badge--warning/)
  assert.match(markup, /ui-card--raised/)
  assert.match(markup, /ui-card-header/)
  assert.match(markup, /ui-card-title/)
  assert.match(markup, /ui-card-description/)
  assert.match(markup, /ui-card-content/)
  assert.match(markup, /ui-card-footer/)
  assert.match(markup, /data-state="closed"/)
  assert.match(markup, /ui-dialog-trigger/)
  assert.match(markup, /ui-dialog-close/)
  assert.match(markup, /ui-dialog-header/)
  assert.match(markup, /ui-dialog-title/)
  assert.match(markup, /ui-dialog-description/)
  assert.match(markup, /ui-dialog-footer/)
  assert.match(markup, /ui-input/)
  assert.match(markup, /ui-textarea/)
  assert.match(markup, /ui-select--sm/)
  assert.match(markup, /role="tablist"/)
  assert.match(markup, /data-state="active"/)
  assert.match(markup, /role="tabpanel"/)
  assert.match(markup, /toast-stack/)
  assert.match(markup, /class="toast-item error"/)
  assert.match(markup, /toast-icon/)
  assert.match(markup, /toast-message/)
  assert.match(markup, /ui-button--secondary/)
})

test("ui input primitives invoke callback branches", () => {
  let checkboxCalls = 0
  const checkboxNode = (Checkbox as unknown as ForwardRefRender).render(
    {
      onChange: () => {
        checkboxCalls += 1
      },
    },
    null
  )
  ;(checkboxNode.props.onChange as (event: unknown) => void)({ target: { checked: true } })
  assert.equal(checkboxCalls, 1)

  let switchOnChangeCalls = 0
  let checkedValues: boolean[] = []
  const switchNode = (Switch as unknown as ForwardRefRender).render(
    {
      checked: false,
      onChange: () => {
        switchOnChangeCalls += 1
      },
      onCheckedChange: (value: boolean) => {
        checkedValues = [...checkedValues, value]
      },
    },
    null
  )
  ;(switchNode.props.onChange as (event: unknown) => void)({ target: { checked: true } })
  assert.equal(switchOnChangeCalls, 1)
  assert.deepEqual(checkedValues, [true])
})

test("ui dialog handlers respect dismiss and escape behavior", () => {
  let dismissCalls = 0
  let overlayOnClickCalls = 0
  const overlayNode = (DialogOverlay as unknown as ForwardRefRender).render(
    {
      onDismiss: () => {
        dismissCalls += 1
      },
      onClick: () => {
        overlayOnClickCalls += 1
      },
    },
    null
  )
  ;(overlayNode.props.onClick as (event: { defaultPrevented: boolean }) => void)({
    defaultPrevented: false,
  })
  assert.equal(overlayOnClickCalls, 1)
  assert.equal(dismissCalls, 1)

  ;(overlayNode.props.onClick as (event: { defaultPrevented: boolean }) => void)({
    defaultPrevented: true,
  })
  assert.equal(overlayOnClickCalls, 2)
  assert.equal(dismissCalls, 1)

  let escapeCalls = 0
  let contentOnKeyDownCalls = 0
  const contentNode = (DialogContent as unknown as ForwardRefRender).render(
    {
      onEscapeKeyDown: () => {
        escapeCalls += 1
      },
      onKeyDown: () => {
        contentOnKeyDownCalls += 1
      },
    },
    null
  )
  ;(contentNode.props.onKeyDown as (event: { key: string; nativeEvent: unknown }) => void)({
    key: "Escape",
    nativeEvent: { key: "Escape" },
  })
  ;(contentNode.props.onKeyDown as (event: { key: string; nativeEvent: unknown }) => void)({
    key: "Enter",
    nativeEvent: { key: "Enter" },
  })
  assert.equal(escapeCalls, 1)
  assert.equal(contentOnKeyDownCalls, 2)
})

test("ui helper exports remain available from index", () => {
  const joined = cn("a", false, undefined, "b")
  assert.equal(joined, "a b")
})

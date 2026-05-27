import { expect } from '@playwright/test'
import { bootstrapButtonBehaviorApp, buttonBehaviorCase, selectorForCase } from './support/button-behavior-harness'

buttonBehaviorCase(
  { case_id: 'params-base-url-input', assertion_type: 'attribute-change' },
  async ({ page }) => {
    await bootstrapButtonBehaviorApp(page)
    const selector = selectorForCase('params-base-url-input')
    const baseUrlInput = page.locator(selector)

    await baseUrlInput.fill('https://example.com/register')
    await expect(baseUrlInput).toHaveValue('https://example.com/register')
  },
)

buttonBehaviorCase(
  { case_id: 'params-toggle-register-password-visibility', assertion_type: 'attribute-change' },
  async ({ page }) => {
    await bootstrapButtonBehaviorApp(page)
    const toggleSelector = selectorForCase('params-toggle-register-password-visibility')
    const registerPasswordInput = page.locator('#register-password')
    const toggleButton = page.locator(toggleSelector)

    await expect(registerPasswordInput).toHaveAttribute('type', 'password')
    await expect(toggleButton).toHaveAttribute('aria-controls', 'register-password')
    await expect(toggleButton).toHaveAttribute('aria-pressed', 'false')
    await toggleButton.click()
    await expect(registerPasswordInput).toHaveAttribute('type', 'text')
    await expect(toggleButton).toHaveAttribute('aria-pressed', 'true')
  },
)

buttonBehaviorCase(
  { case_id: 'params-toggle-api-key-visibility', assertion_type: 'attribute-change' },
  async ({ page }) => {
    await bootstrapButtonBehaviorApp(page)
    const toggleSelector = selectorForCase('params-toggle-api-key-visibility')
    const apiKeyInput = page.locator('#api-key')
    const toggleButton = page.locator(toggleSelector)

    await expect(apiKeyInput).toHaveAttribute('type', 'password')
    await expect(toggleButton).toHaveAttribute('aria-controls', 'api-key')
    await expect(toggleButton).toHaveAttribute('aria-pressed', 'false')
    await toggleButton.click()
    await expect(apiKeyInput).toHaveAttribute('type', 'text')
    await expect(toggleButton).toHaveAttribute('aria-pressed', 'true')
  },
)

buttonBehaviorCase(
  { case_id: 'params-toggle-token-visibility', assertion_type: 'attribute-change' },
  async ({ page }) => {
    await bootstrapButtonBehaviorApp(page)
    const toggleSelector = selectorForCase('params-toggle-token-visibility')
    const tokenInput = page.locator('#automation-token')
    const toggleButton = page.locator(toggleSelector)

    await expect(tokenInput).toHaveAttribute('type', 'password')
    await expect(toggleButton).toHaveAttribute('aria-controls', 'automation-token')
    await expect(toggleButton).toHaveAttribute('aria-pressed', 'false')
    await toggleButton.click()
    await expect(tokenInput).toHaveAttribute('type', 'text')
    await expect(toggleButton).toHaveAttribute('aria-pressed', 'true')
  },
)

import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import TopologyLayerSwitch from './TopologyLayerSwitch.vue'

describe('TopologyLayerSwitch', () => {
  it('has one button per layer showing its state, and asks for the next state on click', async () => {
    const w = mount(TopologyLayerSwitch, { props: { states: { wired: 'shown', wifi: 'grey', zigbee: 'hidden' } } })
    const buttons = w.findAll('.layer-btn')
    expect(buttons.map((b) => b.text())).toEqual(['Wired', 'Wi-Fi', 'Zigbee'])
    expect(buttons[0].classes()).toContain('is-shown')
    expect(buttons[1].classes()).toContain('is-grey')
    expect(buttons[1].attributes('aria-label')).toBe('Wi-Fi layer, grey')
    await buttons[0].trigger('click')
    await buttons[1].trigger('click')
    await buttons[2].trigger('click')
    expect(w.emitted('change')).toEqual([['wired', 'grey'], ['wifi', 'hidden'], ['zigbee', 'shown']])
  })
})

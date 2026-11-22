import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import { JACK_SIZE } from '../presentation/topologyLayout'
import TopologyJack from './TopologyJack.vue'

describe('TopologyJack', () => {
  it('draws an RJ45 port from the front: housing, cavity with the latch notch, five pins', () => {
    const svg = mount(TopologyJack, { props: { shape: 'rj45', kind: 'access', north: false } })
    expect(svg.attributes('width')).toBe(String(JACK_SIZE.rj45.width))
    expect(svg.attributes('height')).toBe(String(JACK_SIZE.rj45.height))
    const body = svg.find('rect.body')
    expect([body.attributes('x'), body.attributes('y'), body.attributes('width'), body.attributes('height'), body.attributes('rx')]).toEqual(
      ['1', '1', '28', '20', '3'],
    )
    expect(svg.find('path.opening').attributes('d')).toBe('M5.5 4.5 H24.5 V13.5 H20.2 V17.8 H9.8 V13.5 H5.5 Z')
    const pins = svg.find('path.pins').attributes('d')!
    expect(pins.match(/M/g)).toHaveLength(5)
    // On the bottom edge it is drawn as is: the notch points down, towards the cable.
    expect(svg.find('g').attributes('transform')).toBeUndefined()
  })

  it('flips on the top edge so the notch still points towards the cable', () => {
    const svg = mount(TopologyJack, { props: { shape: 'rj45', kind: 'access', north: true } })
    expect(svg.find('g').attributes('transform')).toBe(`matrix(1 0 0 -1 0 ${JACK_SIZE.rj45.height})`)
  })

  it('keeps the trunk and unknown variants on the body', () => {
    expect(mount(TopologyJack, { props: { shape: 'rj45', kind: 'trunk', north: false } }).classes()).toContain('kind-trunk')
    expect(mount(TopologyJack, { props: { shape: 'rj45', kind: 'unknown', north: false } }).classes()).toContain('kind-unknown')
  })

  it('leaves the SFP cage and the plain rectangle as they were', () => {
    const sfp = mount(TopologyJack, { props: { shape: 'sfp', kind: 'trunk', north: false } })
    expect(sfp.findAll('rect').map((r) => r.classes()[0])).toEqual(['body', 'opening'])
    expect(sfp.find('.pins').exists()).toBe(false)
    const plain = mount(TopologyJack, { props: { shape: 'plain', kind: 'unknown', north: false } })
    expect(plain.findAll('rect')).toHaveLength(1)
    expect(plain.find('path').exists()).toBe(false)
  })
})

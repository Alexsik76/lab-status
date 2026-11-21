import { describe, expect, it } from 'vitest'
import { parseRoute, routeHash } from './route'

describe('parseRoute', () => {
  it('reads the three pages', () => {
    expect(parseRoute('')).toEqual({ page: 'hosts', focus: null })
    expect(parseRoute('#/')).toEqual({ page: 'hosts', focus: null })
    expect(parseRoute('#/topology')).toEqual({ page: 'topology', focus: null })
    expect(parseRoute('#/topology/')).toEqual({ page: 'topology', focus: null })
    expect(parseRoute('#/arp')).toEqual({ page: 'arp', focus: null })
    expect(parseRoute('#/elsewhere')).toEqual({ page: 'hosts', focus: null })
  })

  it('reads the focus parameter on Hosts and Topology', () => {
    expect(parseRoute('#/?focus=12')).toEqual({ page: 'hosts', focus: '12' })
    expect(parseRoute('#/topology?focus=7&x=1')).toEqual({ page: 'topology', focus: '7' })
  })

  it('ignores an empty or malformed focus, and any focus on ARP', () => {
    expect(parseRoute('#/?focus=').focus).toBeNull()
    expect(parseRoute('#/?focus=a"b').focus).toBeNull()
    expect(parseRoute('#/topology?other=1').focus).toBeNull()
    expect(parseRoute('#/arp?focus=3')).toEqual({ page: 'arp', focus: null })
  })

  it('round-trips with routeHash', () => {
    expect(routeHash('hosts')).toBe('#/')
    expect(routeHash('topology', '12')).toBe('#/topology?focus=12')
    expect(routeHash('arp')).toBe('#/arp')
    expect(parseRoute(routeHash('hosts', '5'))).toEqual({ page: 'hosts', focus: '5' })
  })
})

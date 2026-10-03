import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import Tag from './Tag.vue'

describe('Tag', () => {
  it('renders a "#" sign with tooltip and accessible sr-only text', () => {
    const wrapper = mount(Tag, {
      props: {
        tag: { name: 'portainer', color: '#9c27b0' },
      },
    })

    expect(wrapper.text()).toContain('#')
    expect(wrapper.attributes('title')).toBe('portainer')
    expect(wrapper.attributes('aria-label')).toBe('portainer')

    const sr = wrapper.find('.sr-only')
    expect(sr.exists()).toBe(true)
    expect(sr.text()).toBe('portainer')

    // Style uses the normalized tag color
    expect(wrapper.attributes('style')).toContain('color: #9c27b0')
  })

  it('handles string tag without custom color', () => {
    const wrapper = mount(Tag, {
      props: {
        tag: 'infra',
      },
    })

    expect(wrapper.text()).toContain('#')
    expect(wrapper.attributes('title')).toBe('infra')
    expect(wrapper.attributes('aria-label')).toBe('infra')
    expect(wrapper.attributes('style')).toBeUndefined()
  })

  it('preserves existing # in color', () => {
    const wrapper = mount(Tag, {
      props: {
        tag: { name: 'prod', color: '#ff0000' },
      },
    })
    expect(wrapper.attributes('style')).toContain('color: #ff0000')
  })
})

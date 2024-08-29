import BN, { isBN } from 'bn.js'

export function eq(a: number | BN, b: number | BN): boolean {
  if (isBN(a) && isBN(b)) {
    return a.eq(b)
  } else if (isBN(a) && !isBN(b)) {
    const bb = new BN(b)
    return a.eq(bb)
  } else if (!isBN(a) && isBN(b)) {
    const aa = new BN(a)
    return aa.eq(b)
  } else {
    return a == b
  }
}

export function gt(a: number | BN, b: number | BN): boolean {
  if (isBN(a) && isBN(b)) {
    return a.gt(b)
  } else if (isBN(a) && !isBN(b)) {
    const bb = new BN(b)
    return a.gt(bb)
  } else if (!isBN(a) && isBN(b)) {
    const aa = new BN(a)
    return aa.gt(b)
  } else {
    return a > b
  }
}

export function lt(a: number | BN, b: number | BN): boolean {
  if (isBN(a) && isBN(b)) {
    return a.lt(b)
  } else if (isBN(a) && !isBN(b)) {
    const bb = new BN(b)
    return a.lt(bb)
  } else if (!isBN(a) && isBN(b)) {
    const aa = new BN(a)
    return aa.lt(b)
  } else {
    return a < b
  }
}

export function lte(a: number | BN, b: number | BN): boolean {
  if (isBN(a) && isBN(b)) {
    return a.lte(b)
  } else if (isBN(a) && !isBN(b)) {
    const bb = new BN(b)
    return a.lte(bb)
  } else if (!isBN(a) && isBN(b)) {
    const aa = new BN(a)
    return aa.lte(b)
  } else {
    return a <= b
  }
}

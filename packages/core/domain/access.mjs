/**
 * Which roles may do what. One definition, so "who may teach" cannot mean two things in two places.
 * Each list contains the ones above it: an owner may do everything an administrator may.
 * (What a person on the roll IS — member, supporter, instructor — is in roles.mjs.)
 */
export const MANAGE = Object.freeze(['owner', 'administrator']);
export const REGISTER = Object.freeze(['owner', 'administrator', 'registrar']);
export const TEACH = Object.freeze(['owner', 'administrator', 'registrar', 'instructor']);
export const WRITE = Object.freeze(['owner', 'administrator', 'contributor']);

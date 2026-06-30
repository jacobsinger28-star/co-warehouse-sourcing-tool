import { createContext } from 'react'

// Holds the real dataset decrypted by the Gate (or null → app uses synthetic
// sample data). The password lives only in the Gate's submit handler; only the
// decrypted result flows down here, never the password itself.
export const RealDataContext = createContext(null)

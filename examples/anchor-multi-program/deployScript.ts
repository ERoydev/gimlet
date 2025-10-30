// import { AnchorProvider, Idl, Program, web3 } from "@coral-xyz/anchor";
// import { ProgramA } from "../target/types/program_a";
// import IDL from "../target/idl/program_a.json";
// (async () => {
//   const provider = AnchorProvider.env();

//   const program = new Program<ProgramA>(IDL as Idl, provider);

//   const tx = await program.methods
//     .cpi()
//     .accounts({
//       signer: provider.publicKey,
//       programB: new web3.PublicKey(
//         "Ffit3NoBR7D95jtBDLxUf9uVSwJ4WH15p8QYxwtjKjyM"
//       ),
//       //@ts-ignore
//       systemProgram: web3.SystemProgram.programId,
//     })
//     .signers([provider.wallet.payer])
//     .rpc({ skipPreflight: true });
//   console.log(tx);
// })();
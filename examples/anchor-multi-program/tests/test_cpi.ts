import { AnchorProvider, Program, Wallet, web3, BN } from "@coral-xyz/anchor";
import { LiteSVM } from "../local-litesvm";

import A_IDL from "../target/idl/program_a.json";
import B_IDL from "../target/idl/program_b.json";
import {
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
} from "@solana/web3.js";
import { ProgramA} from "../target/types/program_a";
import { ProgramB } from "../target/types/program_b";
import { assert } from "console";

describe("anchor multi program, litesvm tests", () => {
    let svm: LiteSVM;
    let payer: Keypair;
    let program_a: Program<ProgramA>;
    let program_a_Id: PublicKey;
    let program_b: Program<ProgramB>;
    let program_b_Id: PublicKey;

    before(async () => {
        svm = new LiteSVM();
        payer = new Keypair();
        svm.airdrop(payer.publicKey, BigInt(LAMPORTS_PER_SOL));

        const provider = new AnchorProvider(
            svm as any, 
            new Wallet(payer), 
            {
                commitment: "confirmed",
            }
        );

        program_a = new Program(A_IDL, provider);
        // program_a_Id = new web3.PublicKey('2BJiU3UUhRmroYHXN6iEcbuw7PfDAJqcFRv9AFutQxzQ');
        program_a_Id = program_a.programId;

        svm.addProgramFromFile(program_a_Id, "target/deploy/program_a.so");

        program_b = new Program(B_IDL, provider);
        // program_b_Id = new web3.PublicKey('G8pztLe793X3k3u8FGVdyM9aBaqY8UPYuknzKVyay9N4');
        program_b_Id = program_b.programId;

        svm.addProgramFromFile(program_b_Id, "target/deploy/program_b.so");
    })

    it("test_cpi_from_program_a_to_program_b", async () => {
        console.log("Program A ID:", program_a_Id.toBase58());
        console.log("Program B ID:", program_b_Id.toBase58());
        const cpi_instruction = await program_a.methods
            .cpi()
            .accounts({
                programB: program_b_Id,
            })
            .instruction();

        const blockhash = svm.latestBlockhash();
        const tx = new web3.Transaction();

        tx.recentBlockhash = blockhash;
        tx.add(cpi_instruction);
        tx.sign(payer);
    
        const result = svm.sendTransaction(tx);
        console.log("Transaction result:", JSON.stringify(result, null, 2));
    });
})